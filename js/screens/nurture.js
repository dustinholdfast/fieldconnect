import { JOURNEYS } from '../data.js';
import { emptyPanel, esc } from '../html.js';
import { setState, state } from '../state.js';

export function render(route) {
  const journeyId = route?.params?.journeyId || state.journeyId || 'j1';
  const journey = JOURNEYS.find((j) => j.id === journeyId);
  if (route?.params?.journeyId && !journey) {
    return emptyPanel('Journey not found.');
  }
  const active = journey || JOURNEYS[0];
  if (!JOURNEYS.length) return emptyPanel('No nurture journeys yet.');

  let html = '<div class="fc-two-col-nurture"><aside>';
  JOURNEYS.forEach((j) => {
    html += '<a class="fc-journey-card ' + (j.id === active.id ? 'selected' : '') + '" href="/nurture/' + j.id + '">' +
      '<div style="font-size:14px;font-weight:600">' + esc(j.name) + '</div>' +
      '<div class="text-muted" style="font-size:12px;margin-top:3px">' + esc(j.entry) + '</div>' +
      '<div style="font-size:12px;margin-top:6px;color:var(--color-accent-700)">' + esc(j.enrolled) + '</div></a>';
  });
  html += '</aside><section><h4 style="margin-bottom:4px">' + esc(active.name) + '</h4>' +
    '<p class="text-muted" style="font-size:13px;margin-bottom:16px">Objective: ' + esc(active.objective) + '</p>' +
    '<div class="fc-stat-cards" style="grid-template-columns:repeat(3,1fr)">';
  active.stats.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum" style="font-size:20px">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr>' +
    '<th style="width:130px">Timing</th><th>Step</th><th style="width:150px">Channel</th><th style="width:92px;text-align:right">Engagement</th></tr></thead><tbody>';
  active.steps.forEach((s) => {
    html += '<tr class="fc-row"><td style="color:var(--color-accent-700);font-size:12.5px">' + esc(s[0]) + '</td>' +
      '<td><div style="font-weight:600">' + esc(s[1]) + '</div><div class="text-muted" style="font-size:12px">' + esc(s[2]) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s[3]) + '</td>' +
      '<td class="fc-tnum" style="text-align:right;font-size:12.5px">' + esc(s[4]) + '</td></tr>';
  });
  html += '</tbody></table><p class="text-muted" style="font-size:12.5px;margin-top:16px">Exit: ' + esc(active.exit) +
    '. Quiet hours 9 PM–8 AM local. Immediate opt-out suppression on every channel.</p></section></div>';
  return html;
}

export function mount(_el, route) {
  const id = route?.params?.journeyId;
  if (id && id !== state.journeyId) setState({ journeyId: id });
}

export function unmount() {}
