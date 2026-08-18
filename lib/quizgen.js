'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

// ---------- deterministic RNG (so a daily quiz can be seeded) ----------
function seededRng(seedStr) {
  const h = crypto.createHash('sha256').update(seedStr).digest();
  let a = h.readUInt32LE(0), b = h.readUInt32LE(4), c = h.readUInt32LE(8), d = h.readUInt32LE(12);
  return function () { // sfc32
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

const STOPWORDS = new Set(('the and that unto them they with shall have from were will thou thee thine thy your yours upon into this his her him she who whom what when where which there their then than also because been being before after every about among against would could should said saith says not for are was you all can had has may our out who its these those some more most very just like even over such only')
  .split(/\s+/));

function ref(v) { return `${v.book_name} ${v.chapter}:${v.verse}`; }
function trunc(s, n = 160) { return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }

// ---------- question builders ----------
// Each returns {type, prompt, verseText?, options:[...], correctIndex, ref} or null.

function qFillBlank(v, pool, rnd) {
  const words = v.text.split(/\s+/);
  const candidates = [];
  words.forEach((w, i) => {
    const clean = w.replace(/[^A-Za-z']/g, '');
    if (clean.length >= 4 && !STOPWORDS.has(clean.toLowerCase())) candidates.push({ i, clean });
  });
  if (!candidates.length) return null;
  const target = pick(candidates, rnd);
  const answer = target.clean;
  // distractors: other real words from the same book pool
  const wordBag = new Set();
  for (let tries = 0; tries < 200 && wordBag.size < 12; tries++) {
    const w = pick(pick(pool, rnd).text.split(/\s+/), rnd).replace(/[^A-Za-z']/g, '');
    if (w.length >= 4 && !STOPWORDS.has(w.toLowerCase()) && w.toLowerCase() !== answer.toLowerCase()) wordBag.add(w);
  }
  const distractors = shuffle([...wordBag], rnd).slice(0, 3);
  if (distractors.length < 3) return null;
  const blanked = words.map((w, i) => i === target.i ? w.replace(target.clean, '_____') : w).join(' ');
  const options = shuffle([answer, ...distractors], rnd);
  return {
    type: 'fill-blank',
    prompt: `Fill in the blank (${ref(v)}):`,
    verseText: blanked,
    options,
    correctIndex: options.indexOf(answer),
    ref: ref(v),
  };
}

function qWhichRef(v, pool, rnd) {
  const others = shuffle(pool.filter(p => p.id !== v.id), rnd).slice(0, 3);
  if (others.length < 3) return null;
  const options = shuffle([ref(v), ...others.map(ref)], rnd);
  return {
    type: 'which-ref',
    prompt: 'Where is this verse found?',
    verseText: `“${v.text}”`,
    options,
    correctIndex: options.indexOf(ref(v)),
    ref: ref(v),
  };
}

function qVerseForRef(v, pool, rnd) {
  const others = shuffle(pool.filter(p => p.id !== v.id), rnd).slice(0, 3);
  if (others.length < 3) return null;
  const answer = trunc(v.text);
  const options = shuffle([answer, ...others.map(o => trunc(o.text))], rnd);
  return {
    type: 'verse-for-ref',
    prompt: `Which of these is ${ref(v)}?`,
    options,
    correctIndex: options.indexOf(answer),
    ref: ref(v),
  };
}

function qNextVerse(v, pool, rnd) {
  const next = pool.find(p => p.book_id === v.book_id && p.chapter === v.chapter && p.verse === v.verse + 1);
  if (!next) return null;
  const others = shuffle(pool.filter(p => p.id !== next.id && p.id !== v.id), rnd).slice(0, 3);
  if (others.length < 3) return null;
  const answer = trunc(next.text);
  const options = shuffle([answer, ...others.map(o => trunc(o.text))], rnd);
  return {
    type: 'next-verse',
    prompt: `What comes immediately after this verse? (${ref(v)})`,
    verseText: `“${v.text}”`,
    options,
    correctIndex: options.indexOf(answer),
    ref: `${next.book_name} ${next.chapter}:${next.verse}`,
  };
}

const BUILDERS = [qFillBlank, qWhichRef, qVerseForRef, qNextVerse];

/** Pool of verses across the user's assigned books. */
function versePool(userId) {
  return db.prepare(`
    SELECT v.id, v.book_id, v.chapter, v.verse, v.text, b.name AS book_name
    FROM verses v
    JOIN books b ON b.id = v.book_id
    JOIN assignments a ON a.book_id = v.book_id
    WHERE a.user_id = ?
    ORDER BY v.book_id, v.chapter, v.verse
  `).all(userId);
}

/**
 * Generate a quiz of `count` questions for a user.
 * seedStr makes it deterministic (daily); pass a random seed for practice.
 */
function generateQuiz(userId, seedStr, count = 10) {
  const pool = versePool(userId);
  if (pool.length < 8) return { error: pool.length === 0 ? 'no-books' : 'too-few-verses' };
  const rnd = seededRng(seedStr);
  const questions = [];
  const usedVerseIds = new Set();
  let guard = 0;
  while (questions.length < count && guard++ < count * 40) {
    const v = pick(pool, rnd);
    if (usedVerseIds.has(v.id) && guard < count * 20) continue;
    const builder = BUILDERS[questions.length % BUILDERS.length];
    const q = builder(v, pool, rnd);
    if (q) { questions.push(q); usedVerseIds.add(v.id); }
  }
  if (questions.length < Math.min(count, 4)) return { error: 'too-few-verses' };
  return { questions };
}

module.exports = { generateQuiz, versePool };
