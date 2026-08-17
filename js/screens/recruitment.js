import { apiJson } from '../api.js';
import { emptyPanel, esc } from '../html.js';

let abort = null;
let cache = null;

function boardHtml(board) {
  const stats = board.stats || [];
  const cols = board.columns || [];
  const webinars = board.webinars || [];
  if (cols.length === 0) return emptyPanel('No candidates in the funnel.');

  let html = '<div class="fc-stat-cards">';
  stats.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s.label) + '</div>' +
      '<div class="fc-stat-value fc-tnum">' + esc(s.value) + '</div>' +
      '<div class="text-muted" style="font-size:11.5px;margin-top:4px">' + esc(s.note) + '</div></div>';
  });
  html += '</div><div class="fc-pipeline">';
  cols.forEach((c) => {
    html += '<div class="fc-pipe-col" data-stage="' + esc(c.name) + '"><div class="fc-pipe-head">' + esc(c.name) + '</div>' +
      '<div class="fc-pipe-count">' + esc(c.count) + ' candidates</div>';
    (c.candidates || []).forEach((cand) => {
      html += '<div class="fc-cand" draggable="true" data-id="' + cand.id + '" data-stage="' + esc(c.name) + '">' +
        '<div>' + esc(cand.name) + '</div><div class="fc-cand-meta">' + esc(cand.source) + '</div>' +
        '<button class="btn btn-ghost" type="button" data-advance="' + cand.id + '" style="font-size:11px;margin-top:6px">Advance</button>' +
        '</div>';
    });
    html += '</div>';
  });
  html += '</div><h4 style="margin:8px 0 12px">Orientation webinars</h4>' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Session</th><th>Registered</th><th>Attended</th><th>Qualified</th><th>Activated</th></tr></thead><tbody>';
  webinars.forEach((w) => {
    html += '<tr class="fc-row"><td>' + esc(w.session) + '</td>' +
      '<td class="fc-tnum">' + esc(w.registered) + '</td>' +
      '<td class="fc-tnum">' + esc(w.attended) + '</td>' +
      '<td class="fc-tnum">' + esc(w.qualified) + '</td>' +
      '<td class="fc-tnum">' + esc(w.activated) + '</td></tr>';
  });
  html += '</tbody></table>' +
    '<p class="text-muted" style="font-size:12.5px;margin-top:16px">Drag a card onto another column, or use Advance, to persist the stage.</p>';
  return html;
}

export function render() {
  if (!cache) return emptyPanel('Loading recruitment…');
  return boardHtml(cache);
}

async function load(el, signal) {
  const { ok, data } = await apiJson('/api/recruitment', { signal });
  if (signal?.aborted) return;
  cache = ok ? data : { stats: [], columns: [], webinars: [] };
  el.innerHTML = boardHtml(cache);
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  load(el, signal).catch(() => {});

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-advance]');
    if (!btn) return;
    btn.disabled = true;
    await apiJson('/api/recruitment/candidates/' + btn.dataset.advance + '/advance', {
      method: 'POST', body: {}, signal,
    });
    await load(el, signal);
  }, { signal });

  el.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.fc-cand[data-id]');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  }, { signal });

  el.addEventListener('dragover', (e) => {
    if (!e.target.closest('.fc-pipe-col')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, { signal });

  el.addEventListener('drop', async (e) => {
    const col = e.target.closest('.fc-pipe-col');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const stage = col.dataset.stage;
    if (!id || !stage) return;
    await apiJson('/api/recruitment/candidates/' + id, {
      method: 'POST', body: { stage }, signal,
    });
    await load(el, signal);
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
