import { apiJson } from '../api.js';
import { emptyPanel, esc } from '../html.js';
import { setState, state } from '../state.js';

let abort = null;
let cache = null;

function boardHtml(journeys, route) {
  const journeyId = route?.params?.journeyId || state.journeyId || 'j1';
  const journey = journeys.find((j) => j.id === journeyId);
  if (route?.params?.journeyId && !journey) {
    return emptyPanel('Journey not found.');
  }
  const active = journey || journeys[0];
  if (!journeys.length) return emptyPanel('No nurture journeys yet.');

  let html = '<div class="fc-two-col-nurture"><aside>';
  journeys.forEach((j) => {
    html += '<a class="fc-journey-card ' + (j.id === active.id ? 'selected' : '') + '" href="/nurture/' + encodeURIComponent(j.id) + '">' +
      '<div style="font-size:14px;font-weight:600">' + esc(j.name) + '</div>' +
      '<div class="text-muted" style="font-size:12px;margin-top:3px">' + esc(j.entry) + '</div>' +
      '<div style="font-size:12px;margin-top:6px;color:var(--color-accent-700)">' + esc(j.enrolled) + '</div></a>';
  });
  html += '</aside><section><h4 style="margin-bottom:4px">' + esc(active.name) + '</h4>' +
    '<p class="text-muted" style="font-size:13px;margin-bottom:16px">Objective: ' + esc(active.objective) + '</p>' +
    '<div class="fc-stat-cards" style="grid-template-columns:repeat(3,1fr)">';
  (active.stats || []).forEach((s) => {
    const label = Array.isArray(s) ? s[0] : s.label;
    const value = Array.isArray(s) ? s[1] : s.value;
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(label) + '</div><div class="fc-stat-value fc-tnum" style="font-size:20px">' + esc(value) + '</div></div>';
  });
  html += '</div><table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr>' +
    '<th style="width:130px">Timing</th><th>Step</th><th style="width:150px">Channel</th><th style="width:92px;text-align:right">Engagement</th></tr></thead><tbody>';
  (active.steps || []).forEach((s) => {
    const timing = s.timing ?? s[0];
    const title = s.title ?? s[1];
    const body = s.body ?? s[2];
    const channel = s.channel ?? s[3];
    const engagement = s.engagement ?? s[4];
    html += '<tr class="fc-row"><td style="color:var(--color-accent-700);font-size:12.5px">' + esc(timing) + '</td>' +
      '<td><div style="font-weight:600">' + esc(title) + '</div><div class="text-muted" style="font-size:12px">' + esc(body) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(channel) + '</td>' +
      '<td class="fc-tnum" style="text-align:right;font-size:12.5px">' + esc(engagement) + '</td></tr>';
  });
  html += '</tbody></table><p class="text-muted" style="font-size:12.5px;margin-top:16px">Exit: ' + esc(active.exit) +
    '. Quiet hours 9 PM–8 AM local. Immediate opt-out suppression on every channel.</p>' +
    '<p class="text-muted" style="font-size:12.5px;margin-top:8px">Journey sending is Wave 2. This screen is a read-only template library.</p></section></div>';
  return html;
}

export function render(route) {
  if (!cache) return emptyPanel('Loading journeys…');
  return boardHtml(cache, route);
}

async function load(el, route, signal) {
  const { ok, data } = await apiJson('/api/journeys', { signal });
  if (signal?.aborted) return;
  cache = ok ? (data.items || []) : [];
  el.innerHTML = boardHtml(cache, route);
}

export function mount(el, route) {
  abort = new AbortController();
  const id = route?.params?.journeyId;
  if (id && id !== state.journeyId) setState({ journeyId: id });
  load(el, route, abort.signal).catch(() => {});
}

export function unmount() {
  abort?.abort();
  abort = null;
}
