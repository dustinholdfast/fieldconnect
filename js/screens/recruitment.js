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
    html += '<div class="fc-pipe-col"><div class="fc-pipe-head">' + esc(c.name) + '</div>' +
      '<div class="fc-pipe-count">' + esc(c.count) + ' candidates</div>';
    (c.candidates || []).forEach((cand) => {
      html += '<div class="fc-cand"><div>' + esc(cand.name) + '</div><div class="fc-cand-meta">' + esc(cand.source) + '</div></div>';
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
    '<p class="text-muted" style="font-size:12.5px;margin-top:16px">Drag and stage advance are Wave 3. This board is read-only.</p>';
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
  load(el, abort.signal).catch(() => {});
}

export function unmount() {
  abort?.abort();
  abort = null;
}
