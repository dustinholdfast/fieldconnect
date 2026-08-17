import { apiJson } from '../api.js';
import { ACCENT, emptyPanel, esc } from '../html.js';

const FUNNEL_COLORS = {
  invited: '#d7d3d3',
  registered: '#e1ad66',
  attended: '#e1ad66',
  interested: '#c28d41',
  booked: '#c28d41',
  completed: ACCENT,
  book_sold: '#7d5411',
  seminar_sold: '#7d5411',
};

let abort = null;

function kpiHtml(kpis) {
  const rows = kpis || [
    { key: 'registered', label: 'Registered', value: '—', delta: '' },
    { key: 'attended', label: 'Attended', value: '—', delta: '' },
    { key: 'interested', label: 'Interested', value: '—', delta: '' },
    { key: 'completed', label: 'Completed', value: '—', delta: '' },
    { key: 'books', label: 'Books sold', value: '—', delta: '' },
    { key: 'seminars', label: 'DN Seminars', value: '—', delta: '' },
  ];
  let html = '<div class="fc-kpi-strip">';
  rows.forEach((k) => {
    const value = typeof k.value === 'number' ? k.value.toLocaleString() : String(k.value ?? '—');
    html += '<div class="fc-kpi-cell"><div class="fc-kpi-label">' + esc(k.label) +
      '</div><div class="fc-kpi-value fc-tnum">' + esc(value) +
      '</div><div class="fc-kpi-delta">' + esc(k.delta || '') + '</div></div>';
  });
  return html + '</div>';
}

function funnelHtml(funnel) {
  const rows = funnel || [];
  let html = '<section><h4 style="margin-bottom:3px">Lifecycle funnel</h4>' +
    '<p class="text-muted" style="font-size:12.5px;margin-bottom:12px">From invitation through product result</p>';
  if (!funnel) {
    return html + emptyPanel('Loading funnel…') + '</section>';
  }
  const max = Math.max(1, ...rows.map((f) => Number(f.value) || 0));
  rows.forEach((f) => {
    const value = Number(f.value) || 0;
    const raw = Math.round(value / max * 100);
    const w = value === 0 ? 0 : Math.max(2, raw);
    const color = FUNNEL_COLORS[f.key] || ACCENT;
    html += '<div class="fc-funnel-row"><span>' + esc(f.label) + '</span>' +
      '<div class="fc-bar-track"><div class="fc-bar-fill" style="width:' + w + '%;background:' + color + '"></div></div>' +
      '<span class="fc-tnum" style="text-align:right">' + value.toLocaleString() + '</span>' +
      '<span class="fc-tnum text-muted" style="text-align:right">' + raw + '%</span></div>';
  });
  return html + '</section>';
}

function conversionHtml(byFsm) {
  let html = '<section><h4 style="margin-bottom:3px">Conversion by Field Staff Member</h4>' +
    '<p class="text-muted" style="font-size:12.5px">Completed interviews and product results</p>' +
    '<table class="table" style="width:100%;margin-top:14px;font-size:13px"><thead><tr>' +
    '<th style="text-align:left">FSM</th><th style="text-align:right">Done</th><th style="text-align:right">No-show</th>' +
    '<th style="text-align:right">Books</th><th style="text-align:right">DN Sem.</th></tr></thead><tbody>';
  (byFsm || []).forEach((r) => {
    html += '<tr class="fc-row"><td>' + esc(r.name) + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + (r.done ?? 0) + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + (r.noShow ?? 0) + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + (r.books ?? 0) + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + (r.seminars ?? 0) + '</td></tr>';
  });
  if (!byFsm) {
    html += '<tr class="fc-row"><td colspan="5" class="text-muted">Loading…</td></tr>';
  }
  return html + '</tbody></table>';
}

function attentionHtml(items) {
  let html = '<div class="fc-panel" style="margin-top:22px">' +
    '<div class="fc-section-title">Needs attention</div>';
  if (!items) {
    html += '<p class="text-muted" style="font-size:13px;margin:10px 0 0">Loading…</p>';
  } else if (items.length === 0) {
    html += '<p class="text-muted" style="font-size:13px;margin:10px 0 0">Nothing needs attention</p>';
  } else {
    items.forEach((a) => {
      html += '<a class="fc-attention-row" href="' + esc(a.href) + '">' +
        '<span>' + esc(a.label) + '</span>' +
        '<span class="fc-tnum text-muted">' + esc(String(a.count)) + '</span></a>';
    });
  }
  return html + '</div>';
}

function bodyHtml(dash, attn) {
  return kpiHtml(dash?.kpis) +
    '<div class="fc-two-col-wide">' +
      funnelHtml(dash?.funnel) +
      '<section>' + conversionHtml(dash?.byFsm) + attentionHtml(attn?.items) + '</section>' +
    '</div>';
}

export function render() {
  return '<div id="dash-root">' + bodyHtml(null, null) + '</div>';
}

function paint(el, dash, attn) {
  const root = el.querySelector('#dash-root') || el;
  root.innerHTML = bodyHtml(dash, attn);
}

export function mount(el) {
  abort = new AbortController();
  const signal = abort.signal;
  Promise.all([
    apiJson('/api/dashboard', { signal }),
    apiJson('/api/attention', { signal }),
  ]).then(([dashRes, attnRes]) => {
    if (signal.aborted) return;
    paint(el, dashRes?.ok ? dashRes.data : null, attnRes?.ok ? attnRes.data : { items: [] });
  }).catch(() => {});
}

export function unmount() {
  abort?.abort();
  abort = null;
}
