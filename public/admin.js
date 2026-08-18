'use strict';
// Bible Bowl — coach/admin dashboard

const $ = s => document.querySelector(s);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.rawBody || !opts.body ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.rawBody ? opts.rawBody : (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let BOOKS = [];

// ---------------- tabs ----------------
document.querySelectorAll('.tabs-nav button').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('.tabs-nav button').forEach(x => x.classList.toggle('active', x === b));
    $('#tab-students').classList.toggle('hidden', b.dataset.tab !== 'students');
    $('#tab-books').classList.toggle('hidden', b.dataset.tab !== 'books');
  };
});

// ---------------- students ----------------
async function loadStudents() {
  const r = await api('/api/admin/students');
  $('#today-label').textContent = '· ' + r.today;
  const tb = $('#students-table tbody');
  tb.innerHTML = '';
  $('#no-students').classList.toggle('hidden', r.students.length > 0);
  $('#students-table').classList.toggle('hidden', r.students.length === 0);

  $('#ov-students').textContent = r.students.length;
  $('#ov-today').textContent = r.students.filter(s => s.tookToday).length + '/' + r.students.length;
  const avgs = r.students.map(s => s.avgPct).filter(a => a != null);
  $('#ov-avg').textContent = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) + '%' : '–';

  for (const s of r.students) {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td><strong>${esc(s.name)}</strong><br><span class="tiny">${esc(s.email)}</span></td>
      <td>${s.tookToday ? '<span class="pill good">✓ done</span>' : '<span class="pill neutral">not yet</span>'}</td>
      <td>${s.last ? `${s.last.score}/${s.last.total} <span class="tiny">${s.last.date}</span>` : '–'}</td>
      <td>${s.avgPct != null ? '<strong>' + s.avgPct + '%</strong>' : '–'}</td>
      <td>${s.streak > 0 ? s.streak + ' 🔥' : '0'}</td>
      <td>${s.attempts}</td>
      <td class="tiny">${s.books.length ? esc(s.books.join(', ')) : '<span class="pill bad">none</span>'}</td>`;
    tr.onclick = () => openStudent(s.id);
    tb.appendChild(tr);
  }
}

async function openStudent(id) {
  const r = await api('/api/admin/students/' + id);
  const d = $('#student-detail');
  d.classList.remove('hidden');
  d.dataset.sid = id;
  $('#sd-name').textContent = r.student.name;
  $('#sd-email').textContent = r.student.email;
  $('#sd-avg').textContent = r.stats.avgPct != null ? r.stats.avgPct + '%' : '–';
  $('#sd-streak').textContent = r.stats.streak;
  $('#sd-count').textContent = r.stats.attempts;
  renderScoreChart('#sd-chart', r.stats.recent.map(x => ({ date: x.quiz_date, score: x.score, total: x.total })));

  // book assignment checkboxes
  const assigned = new Set((await api('/api/admin/assignments')).assignments
    .filter(a => a.user_id === id).map(a => a.book_id));
  $('#sd-books').innerHTML = BOOKS.length
    ? BOOKS.map(b => `
      <label class="checkline"><input type="checkbox" value="${b.id}" ${assigned.has(b.id) ? 'checked' : ''}>
      ${esc(b.name)}${b.translation ? ' <span class="tiny">(' + esc(b.translation) + ')</span>' : ''} <span class="tiny">· ${b.verse_count} verses</span></label>`).join('')
    : '<p class="muted">No books uploaded yet — add one on the Scripture Books tab.</p>';
  $('#sd-books-msg').textContent = '';

  // attempts with expandable detail
  $('#sd-attempts').innerHTML = r.attempts.length ? r.attempts.map(a => `
    <details class="review-item" style="padding:10px 0">
      <summary style="cursor:pointer">
        <strong>${a.date}</strong> — ${a.score}/${a.total}
        ${a.score / a.total >= .9 ? '<span class="pill good">excellent</span>' : a.score / a.total >= .7 ? '<span class="pill brand">good</span>' : '<span class="pill bad">needs work</span>'}
      </summary>
      ${a.details.map((q, i) => `
        <div class="r-line" style="margin-top:8px">
          ${i + 1}. ${esc(q.prompt)} ${q.correct ? '✓' : '✗'}
          ${q.correct ? '' : `<div class="tiny">answered: ${q.chosen >= 0 ? esc(q.options[q.chosen]) : '(none)'} · correct: ${esc(q.options[q.correctIndex])}</div>`}
        </div>`).join('')}
    </details>`).join('') : '<p class="muted">No daily quizzes taken yet.</p>';

  d.scrollIntoView({ behavior: 'smooth' });
}

$('#sd-close').onclick = () => $('#student-detail').classList.add('hidden');

$('#sd-save-books').onclick = async () => {
  const id = Number($('#student-detail').dataset.sid);
  const bookIds = [...document.querySelectorAll('#sd-books input:checked')].map(c => Number(c.value));
  await api('/api/admin/assignments/' + id, { method: 'PUT', body: { bookIds } });
  $('#sd-books-msg').textContent = 'Saved ✓';
  loadStudents();
};

$('#sd-delete').onclick = async () => {
  const id = Number($('#student-detail').dataset.sid);
  const name = $('#sd-name').textContent;
  if (!confirm(`Delete ${name}'s account and all their scores? This cannot be undone.`)) return;
  await api('/api/admin/students/' + id, { method: 'DELETE' });
  $('#student-detail').classList.add('hidden');
  loadStudents();
};

// ---------------- books ----------------
async function loadBooks() {
  BOOKS = (await api('/api/admin/books')).books;
  $('#books-list').innerHTML = BOOKS.length ? BOOKS.map(b => `
    <div class="bookchip" style="justify-content:space-between;margin-bottom:8px">
      <span>📚 <strong>${esc(b.name)}</strong>${b.translation ? ' (' + esc(b.translation) + ')' : ''}
        <span class="tiny">· ${b.verse_count} verses · uploaded ${esc(b.uploaded_at).slice(0, 10)}</span></span>
      <button class="danger small" data-del="${b.id}">Delete</button>
    </div>`).join('') : '<p class="muted">No books uploaded yet.</p>';
  document.querySelectorAll('#books-list [data-del]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this book? Students assigned to it will lose it from their quizzes.')) return;
      await api('/api/admin/books/' + btn.dataset.del, { method: 'DELETE' });
      loadBooks();
    };
  });
}

async function uploadFile(file) {
  $('#upload-err').textContent = '';
  $('#upload-ok').textContent = '';
  if (!file) return;
  try {
    const text = await file.text();
    JSON.parse(text); // validate client-side for a friendlier error
    const r = await api('/api/admin/books', { method: 'POST', rawBody: text, headers: { 'Content-Type': 'application/json' } });
    $('#upload-ok').textContent = r.books.map(b => `${b.replaced ? 'Replaced' : 'Added'} “${b.name}” (${b.verses} verses)`).join(' · ');
    loadBooks();
  } catch (e) {
    $('#upload-err').textContent = e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message;
  }
}

$('#btn-browse').onclick = () => $('#file-input').click();
$('#file-input').onchange = e => { uploadFile(e.target.files[0]); e.target.value = ''; };
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault(); drop.classList.remove('over');
  uploadFile(e.dataTransfer.files[0]);
});

// ---------------- init ----------------
$('#btn-logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; };

(async function boot() {
  let me;
  try { me = await api('/api/me'); } catch { location.href = '/'; return; }
  if (me.role !== 'admin') { location.href = '/'; return; }
  $('#whoami').textContent = me.name;
  await loadBooks();
  await loadStudents();
})();
