'use strict';
/**
 * Single-series daily-score bar chart (inline SVG, hover tooltip).
 * data: [{date:'YYYY-MM-DD', score, total}], rendered oldest -> newest.
 */
function renderScoreChart(container, data, opts = {}) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  el.innerHTML = '';
  if (!data || !data.length) {
    el.innerHTML = '<div class="chart-empty">No daily quizzes yet — scores will appear here.</div>';
    return;
  }
  const W = opts.width || 640, H = opts.height || 180;
  const padL = 34, padR = 6, padT = 8, padB = 22;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = data.length;
  const slot = iw / n;
  const barW = Math.max(6, Math.min(28, slot - 4));
  const y = pct => padT + ih - (pct / 100) * ih;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily quiz scores over time');

  // gridlines + y labels at 0/50/100
  for (const g of [0, 50, 100]) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', padL); line.setAttribute('x2', W - padR);
    line.setAttribute('y1', y(g)); line.setAttribute('y2', y(g));
    line.setAttribute('stroke', '#e5e3dd'); line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', padL - 6); t.setAttribute('y', y(g) + 4);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('font-size', '11'); t.setAttribute('fill', '#8a8880');
    t.textContent = g + '%';
    svg.appendChild(t);
  }

  data.forEach((d, i) => {
    const pct = d.total ? (100 * d.score / d.total) : 0;
    const cx = padL + slot * i + slot / 2;
    const barH = Math.max(2, (pct / 100) * ih);
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', cx - barW / 2);
    rect.setAttribute('y', padT + ih - barH);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', barH);
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', '#2a78d6');
    // invisible wider hover target
    const hit = document.createElementNS(NS, 'rect');
    hit.setAttribute('x', padL + slot * i); hit.setAttribute('y', padT);
    hit.setAttribute('width', slot); hit.setAttribute('height', ih);
    hit.setAttribute('fill', 'transparent');
    const show = () => {
      rect.setAttribute('fill', '#1d5eae');
      tip.textContent = `${d.date}: ${d.score}/${d.total} (${Math.round(pct)}%)`;
      const box = wrap.getBoundingClientRect();
      const sx = box.width / W;
      tip.style.left = (cx * sx) + 'px';
      tip.style.top = ((padT + ih - barH) * (box.height / H)) + 'px';
      tip.style.opacity = '1';
    };
    const hide = () => { rect.setAttribute('fill', '#2a78d6'); tip.style.opacity = '0'; };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('mouseleave', hide);
    svg.appendChild(rect);
    svg.appendChild(hit);
    // x label: sparse (first, last, and ~every 5th)
    if (i === 0 || i === n - 1 || (n > 8 && i % 5 === 0)) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', cx); t.setAttribute('y', H - 6);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-size', '10.5'); t.setAttribute('fill', '#8a8880');
      t.textContent = d.date.slice(5); // MM-DD
      svg.appendChild(t);
    }
  });

  wrap.appendChild(svg);
  wrap.appendChild(tip);
  el.appendChild(wrap);
}
