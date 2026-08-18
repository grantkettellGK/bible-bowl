'use strict';
// Bible Bowl — student app

const $ = s => document.querySelector(s);
const views = ['auth', 'dash', 'quiz', 'results'];
function show(view) {
  for (const v of views) $('#view-' + v).classList.toggle('hidden', v !== view);
  window.scrollTo(0, 0);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- auth ----------------
function wireAuth() {
  const tabL = $('#tab-login'), tabR = $('#tab-register');
  const swap = toLogin => {
    tabL.classList.toggle('inactive', !toLogin);
    tabR.classList.toggle('inactive', toLogin);
    $('#form-login').classList.toggle('hidden', !toLogin);
    $('#form-register').classList.toggle('hidden', toLogin);
  };
  tabL.onclick = () => swap(true);
  tabR.onclick = () => swap(false);

  $('#form-login').onsubmit = async e => {
    e.preventDefault();
    $('#li-err').textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: { email: $('#li-email').value, password: $('#li-pass').value } });
      if (r.role === 'admin') { location.href = '/admin'; return; }
      boot();
    } catch (err) { $('#li-err').textContent = err.message; }
  };
  $('#form-register').onsubmit = async e => {
    e.preventDefault();
    $('#re-err').textContent = '';
    try {
      const r = await api('/api/register', { method: 'POST', body: { name: $('#re-name').value, email: $('#re-email').value, password: $('#re-pass').value } });
      if (r.role === 'admin') { location.href = '/admin'; return; }
      boot();
    } catch (err) { $('#re-err').textContent = err.message; }
  };
  $('#btn-logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
}

// ---------------- dashboard ----------------
let ME = null;

async function boot() {
  let me;
  try { me = await api('/api/me'); }
  catch { show('auth'); $('#whoami').textContent = ''; $('#btn-logout').classList.add('hidden'); return; }
  if (me.role === 'admin') { location.href = '/admin'; return; }
  ME = me;
  $('#whoami').textContent = me.name;
  $('#btn-logout').classList.remove('hidden');

  $('#st-streak').textContent = me.stats.streak;
  $('#st-avg').textContent = me.stats.avgPct == null ? '–' : me.stats.avgPct + '%';
  $('#st-count').textContent = me.stats.attempts;
  $('#daily-date').textContent = me.today;

  renderScoreChart('#chart-me', me.stats.recent.map(r => ({ date: r.quiz_date, score: r.score, total: r.total })));

  $('#my-books').innerHTML = me.books.length
    ? me.books.map(b => `<span class="bookchip">📚 ${esc(b.name)}${b.translation ? ' <span class="tiny">(' + esc(b.translation) + ')</span>' : ''} <span class="tiny">${b.verse_count} verses</span></span>`).join('')
    : '<span class="muted">No books assigned yet — ask your coach.</span>';

  // daily card
  const daily = await api('/api/daily');
  const body = $('#daily-body');
  if (daily.error === 'no-books') {
    body.innerHTML = '<p class="muted">No scripture books have been assigned to you yet. Once your coach assigns them, your daily quiz will appear here.</p>';
  } else if (daily.error === 'too-few-verses') {
    body.innerHTML = '<p class="muted">Not enough scripture has been uploaded yet to build a quiz. Check back soon!</p>';
  } else if (daily.done) {
    body.innerHTML = `
      <p><span class="pill good">Completed ✓</span>&nbsp; You scored <strong>${daily.score}/${daily.total}</strong> today.</p>
      <button class="secondary" id="btn-see-daily">Review today’s answers</button>`;
    $('#btn-see-daily').onclick = () => showResults('daily', daily.score, daily.total, daily.details);
  } else {
    body.innerHTML = `
      <p class="muted">10 randomized questions from your assigned books. One graded attempt per day — take your time!</p>
      <button id="btn-start-daily">Start today’s quiz</button>`;
    $('#btn-start-daily').onclick = () => startDaily(daily.questions);
  }
  show('dash');
}

// ---------------- quiz engine ----------------
const QZ = { mode: null, questions: [], i: 0, answers: [], practiceScore: 0 };

function startDaily(questions) {
  Object.assign(QZ, { mode: 'daily', questions, i: 0, answers: new Array(questions.length).fill(-1), practiceScore: 0 });
  $('#quiz-title').textContent = 'Today’s Quiz';
  $('#quiz-note').textContent = 'Answers are graded when you submit at the end.';
  renderQuestion();
  show('quiz');
}

async function startPractice() {
  const count = $('#practice-count').value;
  const btn = $('#btn-practice');
  btn.disabled = true;
  try {
    const r = await api('/api/practice?count=' + count);
    if (r.error) { alert('Not enough scripture uploaded/assigned yet for practice.'); return; }
    Object.assign(QZ, { mode: 'practice', questions: r.questions, i: 0, answers: new Array(r.questions.length).fill(-1), practiceScore: 0 });
    $('#quiz-title').textContent = 'Practice';
    $('#quiz-note').textContent = 'Instant feedback — practice is not graded.';
    renderQuestion();
    show('quiz');
  } finally { btn.disabled = false; }
}

function renderQuestion() {
  const q = QZ.questions[QZ.i];
  $('#quiz-count').textContent = `Question ${QZ.i + 1} of ${QZ.questions.length}`;
  $('#quiz-bar').style.width = (100 * QZ.i / QZ.questions.length) + '%';
  $('#quiz-feedback').textContent = '';
  $('#quiz-feedback').className = 'feedback';
  $('#btn-quiz-next').classList.add('hidden');
  $('#btn-quiz-submit').classList.add('hidden');

  const letters = ['A', 'B', 'C', 'D', 'E'];
  $('#quiz-q').innerHTML = `
    <div class="prompt">${esc(q.prompt)}</div>
    ${q.verseText ? `<div class="versebox">${esc(q.verseText)}</div>` : ''}
    <div class="opts">${q.options.map((o, i) =>
      `<button class="opt" data-i="${i}"><span class="key">${letters[i]}</span>${esc(o)}</button>`).join('')}
    </div>`;

  document.querySelectorAll('#quiz-q .opt').forEach(btn => {
    btn.onclick = () => answer(Number(btn.dataset.i));
  });
}

function answer(idx) {
  const q = QZ.questions[QZ.i];
  QZ.answers[QZ.i] = idx;
  const opts = document.querySelectorAll('#quiz-q .opt');

  if (QZ.mode === 'practice') {
    // instant feedback
    opts.forEach((b, i) => {
      b.disabled = true;
      if (i === q.correctIndex) b.classList.add('correct');
      else if (i === idx) b.classList.add('wrong');
    });
    const fb = $('#quiz-feedback');
    if (idx === q.correctIndex) { QZ.practiceScore++; fb.textContent = 'Correct! ✓'; fb.classList.add('good'); }
    else { fb.textContent = `Not quite — the answer is highlighted. (${q.ref})`; fb.classList.add('bad'); }
    advanceButtons();
  } else {
    // daily: just mark selection, allow changing until moving on
    opts.forEach((b, i) => b.classList.toggle('chosen', i === idx));
    advanceButtons();
  }
}

function advanceButtons() {
  const last = QZ.i === QZ.questions.length - 1;
  $('#btn-quiz-next').classList.toggle('hidden', last);
  $('#btn-quiz-submit').classList.toggle('hidden', !last);
}

function wireQuiz() {
  $('#btn-quiz-next').onclick = () => {
    if (QZ.answers[QZ.i] < 0) return;
    QZ.i++;
    renderQuestion();
  };
  $('#btn-quiz-submit').onclick = async () => {
    if (QZ.answers[QZ.i] < 0) return;
    if (QZ.mode === 'daily') {
      const btn = $('#btn-quiz-submit');
      btn.disabled = true;
      try {
        const r = await api('/api/daily/submit', { method: 'POST', body: { answers: QZ.answers } });
        showResults('daily', r.score, r.total, r.details);
      } catch (err) {
        alert(err.message);
        boot();
      } finally { btn.disabled = false; }
    } else {
      // practice: build local review
      const details = QZ.questions.map((q, i) => ({
        prompt: q.prompt, verseText: q.verseText || null, ref: q.ref, options: q.options,
        chosen: QZ.answers[i], correctIndex: q.correctIndex, correct: QZ.answers[i] === q.correctIndex,
      }));
      showResults('practice', QZ.practiceScore, QZ.questions.length, details);
    }
  };
  $('#btn-quiz-quit').onclick = () => {
    if (QZ.mode === 'daily' && !confirm('Leave the quiz? Your daily quiz stays open — you can come back and finish it today.')) return;
    boot();
  };
  $('#btn-res-home').onclick = () => boot();
}

// ---------------- results ----------------
function showResults(mode, score, total, details) {
  $('#res-label').textContent = mode === 'daily' ? 'Today’s Quiz — final score' : 'Practice round';
  $('#res-score').textContent = `${score}/${total}`;
  const pct = Math.round(100 * score / total);
  $('#res-sub').textContent = pct >= 90 ? `${pct}% — Excellent!` : pct >= 70 ? `${pct}% — Good work!` : `${pct}% — Keep studying!`;
  $('#res-review').innerHTML = (details || []).map((d, i) => `
    <div class="review-item">
      <div class="r-prompt">${i + 1}. ${esc(d.prompt)} ${d.correct ? '<span class="pill good">✓</span>' : '<span class="pill bad">✗</span>'}</div>
      ${d.verseText ? `<div class="r-line tiny">${esc(d.verseText)}</div>` : ''}
      <div class="r-line">Your answer: <strong>${d.chosen >= 0 ? esc(d.options[d.chosen]) : '(none)'}</strong></div>
      ${d.correct ? '' : `<div class="r-line">Correct answer: <strong>${esc(d.options[d.correctIndex])}</strong> <span class="tiny">(${esc(d.ref || '')})</span></div>`}
    </div>`).join('');
  show('results');
}

// ---------------- init ----------------
wireAuth();
wireQuiz();
$('#btn-practice').onclick = startPractice;
boot();
