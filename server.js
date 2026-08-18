'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, getSecret } = require('./lib/db');
const auth = require('./lib/auth');
const { generateQuiz } = require('./lib/quizgen');

const PORT = Number(process.env.PORT) || 3000;
const QUIZ_TZ = process.env.QUIZ_TZ || 'America/New_York';
const DAILY_COUNT = Number(process.env.DAILY_COUNT) || 10;
const SECRET = getSecret();
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- helpers ----------
function todayStr() { // YYYY-MM-DD in the quiz timezone
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('bad-json'); }
}

// strip answers before sending a quiz to the client
function publicQuiz(questions) {
  return questions.map(({ correctIndex, ...rest }) => rest);
}

// ---------- scripture JSON normalizer ----------
// Accepts:
//  A) { book, translation?, chapters: [ { chapter: 1, verses: [ { verse: 1, text } ] } ] }
//  B) { book, translation?, chapters: [ { chapter: 1, verses: ["text1", "text2"] } ] }
//  C) { book, translation?, chapters: { "1": { "1": "text", "2": "text" } } }
function normalizeBook(input) {
  const name = (input.book || input.name || '').toString().trim();
  if (!name) throw new Error('Missing "book" name');
  const translation = (input.translation || '').toString().trim();
  const out = [];
  const ch = input.chapters;
  if (Array.isArray(ch)) {
    for (const c of ch) {
      const chapNum = Number(c.chapter ?? c.num);
      if (!Number.isInteger(chapNum) || chapNum < 1) throw new Error('Each chapter needs an integer "chapter" number');
      const verses = c.verses;
      if (Array.isArray(verses)) {
        verses.forEach((v, i) => {
          if (typeof v === 'string') out.push({ chapter: chapNum, verse: i + 1, text: v.trim() });
          else {
            const vn = Number(v.verse ?? v.num ?? i + 1);
            const text = (v.text ?? '').toString().trim();
            if (text) out.push({ chapter: chapNum, verse: vn, text });
          }
        });
      } else if (verses && typeof verses === 'object') {
        for (const [vn, text] of Object.entries(verses)) out.push({ chapter: chapNum, verse: Number(vn), text: String(text).trim() });
      }
    }
  } else if (ch && typeof ch === 'object') {
    for (const [cn, verses] of Object.entries(ch)) {
      for (const [vn, text] of Object.entries(verses)) out.push({ chapter: Number(cn), verse: Number(vn), text: String(text).trim() });
    }
  } else {
    throw new Error('Missing "chapters" (array or object)');
  }
  const clean = out.filter(v => v.text && Number.isInteger(v.chapter) && Number.isInteger(v.verse));
  if (!clean.length) throw new Error('No verses found in file');
  return { name, translation, verses: clean };
}

// ---------- stats ----------
function studentStats(userId) {
  const rows = db.prepare(`
    SELECT quiz_date, score, total FROM attempts
    WHERE user_id = ? AND mode = 'daily' ORDER BY quiz_date DESC LIMIT 60
  `).all(userId);
  const agg = db.prepare(`
    SELECT COUNT(*) AS n, AVG(100.0 * score / total) AS avg_pct
    FROM attempts WHERE user_id = ? AND mode = 'daily'
  `).get(userId);
  // streak: consecutive days with a daily attempt, counting back from today/yesterday
  const dates = new Set(rows.map(r => r.quiz_date));
  let streak = 0;
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: QUIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (!dates.has(fmt.format(d))) d.setDate(d.getDate() - 1); // today not done yet -> start from yesterday
  while (dates.has(fmt.format(d))) { streak++; d.setDate(d.getDate() - 1); }
  return {
    attempts: agg.n,
    avgPct: agg.avg_pct == null ? null : Math.round(agg.avg_pct * 10) / 10,
    streak,
    recent: rows.slice(0, 30).reverse(), // oldest -> newest for charting
  };
}

// ---------- route table ----------
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

// --- auth ---
route('POST', '/api/register', async (req, res) => {
  const { name, email, password } = await readJson(req);
  if (!name || !email || !password) return json(res, 400, { error: 'Name, email, and password are required.' });
  if (String(password).length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return json(res, 400, { error: 'Invalid email address.' });
  const isFirst = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n === 0;
  try {
    const info = db.prepare(`INSERT INTO users (email, name, pass_hash, role) VALUES (?, ?, ?, ?)`)
      .run(String(email).trim(), String(name).trim(), auth.hashPassword(String(password)), isFirst ? 'admin' : 'student');
    const token = auth.createSession(Number(info.lastInsertRowid));
    res.setHeader('Set-Cookie', auth.sessionCookie(token));
    json(res, 200, { ok: true, role: isFirst ? 'admin' : 'student' });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return json(res, 409, { error: 'An account with that email already exists.' });
    throw e;
  }
});

route('POST', '/api/login', async (req, res) => {
  const { email, password } = await readJson(req);
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email || '').trim());
  if (!user || !auth.verifyPassword(String(password || ''), user.pass_hash)) {
    return json(res, 401, { error: 'Incorrect email or password.' });
  }
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(token));
  json(res, 200, { ok: true, role: user.role });
});

route('POST', '/api/logout', async (req, res, user) => {
  if (user) auth.destroySession(user.session_token);
  res.setHeader('Set-Cookie', auth.sessionCookie('', { clear: true }));
  json(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res, user) => {
  if (!user) return json(res, 401, { error: 'Not signed in.' });
  const books = db.prepare(`
    SELECT b.id, b.name, b.translation, b.verse_count FROM assignments a JOIN books b ON b.id = a.book_id
    WHERE a.user_id = ? ORDER BY b.name`).all(user.id);
  json(res, 200, {
    id: user.id, name: user.name, email: user.email, role: user.role,
    books, today: todayStr(), stats: studentStats(user.id),
  });
});

// --- daily quiz ---
route('GET', '/api/daily', async (req, res, user) => {
  if (!user) return json(res, 401, { error: 'Not signed in.' });
  const date = todayStr();
  const done = db.prepare(`SELECT score, total, details_json FROM attempts WHERE user_id=? AND quiz_date=? AND mode='daily'`).get(user.id, date);
  if (done) return json(res, 200, { date, done: true, score: done.score, total: done.total, details: JSON.parse(done.details_json) });

  let stored = db.prepare(`SELECT quiz_json FROM daily_quizzes WHERE user_id=? AND quiz_date=?`).get(user.id, date);
  let questions;
  if (stored) {
    questions = JSON.parse(stored.quiz_json);
  } else {
    const seed = `${SECRET}:${user.id}:${date}`;
    const gen = generateQuiz(user.id, seed, DAILY_COUNT);
    if (gen.error === 'no-books') return json(res, 200, { date, error: 'no-books' });
    if (gen.error) return json(res, 200, { date, error: 'too-few-verses' });
    questions = gen.questions;
    db.prepare(`INSERT INTO daily_quizzes (user_id, quiz_date, quiz_json) VALUES (?, ?, ?)`)
      .run(user.id, date, JSON.stringify(questions));
  }
  json(res, 200, { date, done: false, questions: publicQuiz(questions) });
});

route('POST', '/api/daily/submit', async (req, res, user) => {
  if (!user) return json(res, 401, { error: 'Not signed in.' });
  const date = todayStr();
  const already = db.prepare(`SELECT id FROM attempts WHERE user_id=? AND quiz_date=? AND mode='daily'`).get(user.id, date);
  if (already) return json(res, 409, { error: 'You already completed today’s quiz.' });
  const stored = db.prepare(`SELECT quiz_json FROM daily_quizzes WHERE user_id=? AND quiz_date=?`).get(user.id, date);
  if (!stored) return json(res, 400, { error: 'No quiz was started for today.' });
  const { answers } = await readJson(req);
  const questions = JSON.parse(stored.quiz_json);
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    return json(res, 400, { error: 'Answers do not match the quiz.' });
  }
  let score = 0;
  const details = questions.map((q, i) => {
    const chosen = Number.isInteger(answers[i]) ? answers[i] : -1;
    const correct = chosen === q.correctIndex;
    if (correct) score++;
    return { prompt: q.prompt, verseText: q.verseText || null, ref: q.ref, options: q.options, chosen, correctIndex: q.correctIndex, correct };
  });
  db.prepare(`INSERT INTO attempts (user_id, quiz_date, mode, score, total, details_json) VALUES (?, ?, 'daily', ?, ?, ?)`)
    .run(user.id, date, score, questions.length, JSON.stringify(details));
  json(res, 200, { score, total: questions.length, details });
});

// --- practice (unlimited, instant feedback, not counted in averages) ---
route('GET', '/api/practice', async (req, res, user, url) => {
  if (!user) return json(res, 401, { error: 'Not signed in.' });
  const count = Math.min(25, Math.max(3, Number(url.searchParams.get('count')) || 10));
  const seed = crypto.randomBytes(16).toString('hex');
  const gen = generateQuiz(user.id, seed, count);
  if (gen.error) return json(res, 200, { error: gen.error });
  // practice includes correctIndex so the client can give instant feedback
  json(res, 200, { questions: gen.questions });
});

route('GET', '/api/history', async (req, res, user) => {
  if (!user) return json(res, 401, { error: 'Not signed in.' });
  const rows = db.prepare(`SELECT quiz_date, score, total FROM attempts WHERE user_id=? AND mode='daily' ORDER BY quiz_date DESC LIMIT 90`).all(user.id);
  json(res, 200, { attempts: rows.map(r => ({ date: r.quiz_date, score: r.score, total: r.total })) });
});

// --- admin ---
function requireAdmin(res, user) {
  if (!user) { json(res, 401, { error: 'Not signed in.' }); return false; }
  if (user.role !== 'admin') { json(res, 403, { error: 'Admin only.' }); return false; }
  return true;
}

route('GET', '/api/admin/students', async (req, res, user) => {
  if (!requireAdmin(res, user)) return;
  const students = db.prepare(`SELECT id, name, email, created_at FROM users WHERE role='student' ORDER BY name`).all();
  const out = students.map(s => {
    const st = studentStats(s.id);
    const bookRows = db.prepare(`SELECT b.name FROM assignments a JOIN books b ON b.id=a.book_id WHERE a.user_id=? ORDER BY b.name`).all(s.id);
    const last = st.recent.length ? st.recent[st.recent.length - 1] : null;
    return {
      id: s.id, name: s.name, email: s.email,
      books: bookRows.map(b => b.name),
      attempts: st.attempts, avgPct: st.avgPct, streak: st.streak,
      recent: st.recent,
      last: last ? { date: last.quiz_date, score: last.score, total: last.total } : null,
      tookToday: st.recent.some(r => r.quiz_date === todayStr()),
    };
  });
  json(res, 200, { today: todayStr(), students: out });
});

route('GET', '/api/admin/students/:id', async (req, res, user, url, params) => {
  if (!requireAdmin(res, user)) return;
  const s = db.prepare(`SELECT id, name, email FROM users WHERE id=? AND role='student'`).get(Number(params.id));
  if (!s) return json(res, 404, { error: 'Student not found.' });
  const attempts = db.prepare(`SELECT quiz_date, score, total, details_json FROM attempts WHERE user_id=? AND mode='daily' ORDER BY quiz_date DESC LIMIT 90`).all(s.id);
  json(res, 200, {
    student: s, stats: studentStats(s.id),
    attempts: attempts.map(a => ({ date: a.quiz_date, score: a.score, total: a.total, details: JSON.parse(a.details_json) })),
  });
});

route('DELETE', '/api/admin/students/:id', async (req, res, user, url, params) => {
  if (!requireAdmin(res, user)) return;
  db.prepare(`DELETE FROM users WHERE id=? AND role='student'`).run(Number(params.id));
  json(res, 200, { ok: true });
});

route('GET', '/api/admin/books', async (req, res, user) => {
  if (!requireAdmin(res, user)) return;
  json(res, 200, { books: db.prepare(`SELECT * FROM books ORDER BY name`).all() });
});

route('POST', '/api/admin/books', async (req, res, user) => {
  if (!requireAdmin(res, user)) return;
  let body;
  try { body = await readJson(req); } catch (e) { return json(res, 400, { error: 'File is not valid JSON.' }); }
  const items = Array.isArray(body) ? body : [body]; // allow an array of books in one file
  const results = [];
  for (const item of items) {
    let book;
    try { book = normalizeBook(item); } catch (e) { return json(res, 400, { error: e.message }); }
    const existing = db.prepare(`SELECT id FROM books WHERE name=? AND translation=?`).get(book.name, book.translation);
    let bookId;
    if (existing) { // re-upload replaces the book's verses
      bookId = existing.id;
      db.prepare(`DELETE FROM verses WHERE book_id=?`).run(bookId);
    } else {
      bookId = Number(db.prepare(`INSERT INTO books (name, translation) VALUES (?, ?)`).run(book.name, book.translation).lastInsertRowid);
    }
    const ins = db.prepare(`INSERT OR REPLACE INTO verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)`);
    for (const v of book.verses) ins.run(bookId, v.chapter, v.verse, v.text);
    db.prepare(`UPDATE books SET verse_count=? WHERE id=?`).run(book.verses.length, bookId);
    results.push({ id: bookId, name: book.name, translation: book.translation, verses: book.verses.length, replaced: !!existing });
  }
  json(res, 200, { ok: true, books: results });
});

route('DELETE', '/api/admin/books/:id', async (req, res, user, url, params) => {
  if (!requireAdmin(res, user)) return;
  db.prepare(`DELETE FROM books WHERE id=?`).run(Number(params.id));
  json(res, 200, { ok: true });
});

route('GET', '/api/admin/assignments', async (req, res, user) => {
  if (!requireAdmin(res, user)) return;
  json(res, 200, { assignments: db.prepare(`SELECT user_id, book_id FROM assignments`).all() });
});

route('PUT', '/api/admin/assignments/:userId', async (req, res, user, url, params) => {
  if (!requireAdmin(res, user)) return;
  const uid = Number(params.userId);
  const target = db.prepare(`SELECT id FROM users WHERE id=?`).get(uid);
  if (!target) return json(res, 404, { error: 'User not found.' });
  const { bookIds } = await readJson(req);
  if (!Array.isArray(bookIds)) return json(res, 400, { error: 'bookIds must be an array.' });
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM assignments WHERE user_id=?`).run(uid);
    const ins = db.prepare(`INSERT OR IGNORE INTO assignments (user_id, book_id) VALUES (?, ?)`);
    for (const b of bookIds) ins.run(uid, Number(b));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  json(res, 200, { ok: true });
});

// ---------- static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/admin') file = '/admin.html';
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const user = auth.getUser(req);
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const patParts = r.pattern.split('/');
        const parts = pathname.split('/');
        if (patParts.length !== parts.length) continue;
        const params = {};
        let match = true;
        for (let i = 0; i < patParts.length; i++) {
          if (patParts[i].startsWith(':')) params[patParts[i].slice(1)] = parts[i];
          else if (patParts[i] !== parts[i]) { match = false; break; }
        }
        if (!match) continue;
        await r.handler(req, res, user, url, params);
        return;
      }
      return json(res, 404, { error: 'Unknown API route.' });
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    if (e.message === 'bad-json') return json(res, 400, { error: 'Invalid JSON body.' });
    if (e.message === 'too-large') return json(res, 413, { error: 'Upload too large (25 MB max).' });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error.' });
  }
});

// periodic session cleanup
setInterval(() => {
  try { db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run(); } catch {}
}, 6 * 3600 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Bible Bowl app running on http://localhost:${PORT} (quiz timezone: ${QUIZ_TZ})`);
});
