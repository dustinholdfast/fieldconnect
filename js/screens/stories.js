import { apiJson } from '../api.js';
import { emptyPanel, esc, OK, WARN } from '../html.js';

let abort = null;
let cache = null;

function stageCounts(stories) {
  const order = ['Submitted', 'Screened', 'Recorded', 'Consent pending', 'Published'];
  const counts = new Map(order.map((name) => [name, 0]));
  for (const s of stories) {
    if (counts.has(s.stage)) counts.set(s.stage, counts.get(s.stage) + 1);
  }
  return order.map((name) => [name, String(counts.get(name) || 0)]);
}

function boardHtml(stories) {
  if (!stories.length) return emptyPanel('No stories in the pipeline.');

  let html = '<div class="fc-stage-cards">';
  stageCounts(stories).forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 300px;gap:28px;align-items:start">' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contributor</th><th>Story summary</th><th>Stage</th><th>Release</th><th></th></tr></thead><tbody>';
  stories.forEach((s) => {
    const releaseColor = String(s.release || '').includes('Not requested') ? WARN : OK;
    html += '<tr class="fc-row"><td><div>' + esc(s.contributor) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(s.source) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s.summary) + '</td>' +
      '<td><span class="tag tag-outline" style="font-size:11px">' + esc(s.stage) + '</span></td>' +
      '<td style="color:' + releaseColor + ';font-size:12.5px">' + esc(s.release) + '</td>' +
      '<td><button class="btn btn-ghost" data-advance="' + s.id + '" style="font-size:12px" type="button">Advance → ' + esc(s.next) + '</button></td></tr>';
  });
  html += '</tbody></table><aside class="fc-panel"><div class="fc-section-title">Consent record</div>' +
    '<p class="text-muted" style="font-size:12.5px;margin:10px 0">Stored separately from the story text. Names allowed channels and withdrawal dates.</p>' +
    '<div style="font-size:13px;margin-top:12px">' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Newsletter — signed 12 Aug</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Social (SCN groups) — signed 12 Aug</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">Training examples — pending</div>' +
    '<div style="padding:6px 0">Public website — withdrawn 3 Sep</div></div>' +
    '<p class="text-muted" style="font-size:12px;margin-top:16px">Repurposing destinations: recruitment funnel, newsletter, social, training.</p></aside></div>';
  return html;
}

export function render() {
  if (!cache) return emptyPanel('Loading stories…');
  return boardHtml(cache);
}

async function load(el, signal) {
  const { ok, data } = await apiJson('/api/stories', { signal });
  if (signal?.aborted) return;
  cache = ok ? (data.items || []) : [];
  el.innerHTML = boardHtml(cache);
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  load(el, signal).catch(() => {});
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-advance]');
    if (!btn) return;
    const id = btn.dataset.advance;
    btn.disabled = true;
    const { ok, data } = await apiJson('/api/stories/' + id + '/advance', { method: 'POST', body: {}, signal });
    if (signal.aborted) return;
    if (!ok) {
      btn.disabled = false;
      return;
    }
    cache = (cache || []).map((s) => (String(s.id) === String(id)
      ? { ...s, stage: data.stage, next: data.next }
      : s));
    el.innerHTML = boardHtml(cache);
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
}
