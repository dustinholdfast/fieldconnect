import { ACCENT, esc } from '../html.js';

export function render() {
  const kpis = [
    ['Registered', '412', '+38 this week'],
    ['Attended', '287', '70% of registered'],
    ['Interested', '134', '47% of attendees'],
    ['Completed', '96', '81% of booked'],
    ['Books sold', '41', '43% of completed'],
    ['DN Seminars', '18', '19% of completed']
  ];
  const funnel = [
    ['Invited (Div 6 + Meetup)', 1840, '#d7d3d3'],
    ['Registered', 412, '#e1ad66'],
    ['Attended', 287, '#e1ad66'],
    ['Expressed interest', 134, '#c28d41'],
    ['Booked', 118, '#c28d41'],
    ['Completed', 96, ACCENT],
    ['Book sold', 41, '#7d5411'],
    ['DN Seminar sold', 18, '#7d5411']
  ];
  const fsmRows = [
    ['D. Whitfield', 34, 6, 15, 7],
    ['S. Lindgren', 28, 3, 13, 6],
    ['J. Okonjo', 17, 5, 7, 3],
    ['R. Marchetti', 11, 4, 4, 1],
    ['P. Nakamura', 6, 4, 2, 1]
  ];
  const attention = [
    ['Outcome forms overdue > 48 h', '7'],
    ['Follow-up tasks past due', '12'],
    ['Appointments unconfirmed within 24 h', '4'],
    ['Contacts with no lawful basis recorded', '2']
  ];

  let html = '<div class="fc-kpi-strip">';
  kpis.forEach(k => {
    html += '<div class="fc-kpi-cell"><div class="fc-kpi-label">' + esc(k[0]) +
      '</div><div class="fc-kpi-value fc-tnum">' + esc(k[1]) +
      '</div><div class="fc-kpi-delta">' + esc(k[2]) + '</div></div>';
  });
  html += '</div><div class="fc-two-col-wide"><section><h4 style="margin-bottom:3px">Lifecycle funnel</h4>' +
    '<p class="text-muted" style="font-size:12.5px;margin-bottom:12px">From invitation through product result</p>';
  funnel.forEach(f => {
    const w = Math.max(2, Math.round(f[1] / 1840 * 100));
    html += '<div class="fc-funnel-row"><span>' + esc(f[0]) + '</span>' +
      '<div class="fc-bar-track"><div class="fc-bar-fill" style="width:' + w + '%;background:' + f[2] + '"></div></div>' +
      '<span class="fc-tnum" style="text-align:right">' + f[1].toLocaleString() + '</span>' +
      '<span class="fc-tnum text-muted" style="text-align:right">' + w + '%</span></div>';
  });
  html += '</section><section><h4 style="margin-bottom:3px">Conversion by Field Staff Member</h4>' +
    '<p class="text-muted" style="font-size:12.5px">Completed interviews and product results</p>' +
    '<table class="table" style="width:100%;margin-top:14px;font-size:13px"><thead><tr>' +
    '<th style="text-align:left">FSM</th><th style="text-align:right">Done</th><th style="text-align:right">No-show</th>' +
    '<th style="text-align:right">Books</th><th style="text-align:right">DN Sem.</th></tr></thead><tbody>';
  fsmRows.forEach(r => {
    html += '<tr class="fc-row"><td>' + esc(r[0]) + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + r[1] + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + r[2] + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + r[3] + '</td>' +
      '<td class="fc-tnum" style="text-align:right">' + r[4] + '</td></tr>';
  });
  html += '</tbody></table><div class="fc-panel" style="margin-top:22px">' +
    '<div class="fc-section-title">Needs attention</div>';
  attention.forEach(a => {
    html += '<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
      '<span>' + esc(a[0]) + '</span><span class="fc-tnum text-muted">' + esc(a[1]) + '</span></div>';
  });
  html += '</div></section></div>';
  return html;
}

export function mount() {}

export function unmount() {}
