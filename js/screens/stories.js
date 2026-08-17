import { apiJson } from '../api.js';
import { emptyPanel, esc, OK, WARN } from '../html.js';

let abort = null;
let cache = null;
let selectedId = null;

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
  const selected = stories.find((s) => String(s.id) === String(selectedId)) || stories[0];
  stories.forEach((s) => {
    const releaseColor = String(s.release || '').includes('Not requested') ? WARN : OK;
    const isSel = selected && s.id === selected.id;
    html += '<tr class="fc-row' + (isSel ? ' selected' : '') + '" data-select="' + s.id + '" style="cursor:pointer">' +
      '<td><div>' + esc(s.contributor) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(s.source) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s.summary) + '</td>' +
      '<td><span class="tag tag-outline" style="font-size:11px">' + esc(s.stage) + '</span></td>' +
      '<td style="color:' + releaseColor + ';font-size:12.5px">' + esc(s.release) + '</td>' +
      '<td><button class="btn btn-ghost" data-advance="' + s.id + '" style="font-size:12px" type="button">Advance → ' + esc(s.next) + '</button></td></tr>';
  });
  html += '</tbody></table><aside class="fc-panel"><div class="fc-section-title">Consent record</div>';
  if (selected) {
    html += '<p class="text-muted" style="font-size:12.5px;margin:10px 0">' + esc(selected.contributor) +
      ' — stored separately from the story text. Publish requires at least one active channel.</p>';
    (selected.consents || []).forEach((c) => {
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
        '<span>' + esc(c.channel) + (c.active ? ' — granted' : (c.withdrawnAt ? ' — withdrawn' : ' — pending')) + '</span>' +
        (c.active
          ? '<button class="btn btn-ghost" type="button" data-withdraw="' + selected.id + '" data-channel="' + esc(c.channel) + '">Withdraw</button>'
          : '') +
        '</div>';
    });
    html += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">' +
      ['newsletter', 'social', 'training', 'website'].map((ch) =>
        '<button class="btn btn-secondary" type="button" data-grant="' + selected.id + '" data-channel="' + ch + '" style="font-size:12px">Grant ' + ch + '</button>'
      ).join('') +
      '</div>';
  } else {
    html += '<p class="text-muted" style="font-size:12.5px;margin:10px 0">Select a story to grant or withdraw channel consent.</p>';
  }
  html += '<p class="text-muted" style="font-size:12px;margin-top:16px">Withdrawal of the last active channel unpublishes to Approved.</p></aside></div>';
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
  if (selectedId == null && cache[0]) selectedId = cache[0].id;
  el.innerHTML = boardHtml(cache);
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  load(el, signal).catch(() => {});
  el.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-select]');
    if (pick && !e.target.closest('[data-advance]')) {
      selectedId = Number(pick.dataset.select);
      el.innerHTML = boardHtml(cache || []);
      return;
    }
    const btn = e.target.closest('[data-advance]');
    if (btn) {
      const id = btn.dataset.advance;
      btn.disabled = true;
      const { ok, data } = await apiJson('/api/stories/' + id + '/advance', { method: 'POST', body: {}, signal });
      if (signal.aborted) return;
      if (!ok) {
        btn.disabled = false;
        btn.title = data?.error?.message || 'Could not advance';
        return;
      }
      selectedId = Number(id);
      cache = (cache || []).map((s) => (String(s.id) === String(id) ? { ...s, ...data } : s));
      el.innerHTML = boardHtml(cache);
      return;
    }
    const grant = e.target.closest('[data-grant]');
    if (grant) {
      const { ok, data } = await apiJson('/api/stories/' + grant.dataset.grant + '/consents', {
        method: 'POST', body: { channel: grant.dataset.channel }, signal,
      });
      if (ok) {
        selectedId = data.id;
        cache = (cache || []).map((s) => (String(s.id) === String(data.id) ? data : s));
        el.innerHTML = boardHtml(cache);
      }
      return;
    }
    const withdraw = e.target.closest('[data-withdraw]');
    if (!withdraw) return;
    const { ok, data } = await apiJson(
      '/api/stories/' + withdraw.dataset.withdraw + '/consents/' + withdraw.dataset.channel + '/withdraw',
      { method: 'POST', body: {}, signal },
    );
    if (ok) {
      selectedId = data.id;
      cache = (cache || []).map((s) => (String(s.id) === String(data.id) ? data : s));
      el.innerHTML = boardHtml(cache);
    }
  }, { signal });
}

export function unmount() {
  abort?.abort();
  abort = null;
  selectedId = null;
}
