import { emptyPanel, esc } from '../html.js';

export function render() {
  const stats = [
    ['Candidates in funnel', '64', 'across 3 Churches'],
    ['Orientation attendance', '71%', '+6 pts vs last wave'],
    ['Activation rate', '38%', 'of orientation attendees'],
    ['Median time to first activity', '11 d', 'target: 14 d']
  ];
  const cols = [
    ['Prospect', 12, [['A. Mensah', 'Referral'], ['L. Park', 'Social']]],
    ['Interested', 9, [['K. Voss', 'Email'], ['T. Okoro', 'Referral']]],
    ['Orient. registered', 11, [['M. Silva', 'Webinar'], ['J. Cho', 'Referral']]],
    ['Orient. attended', 8, [['R. Patel', 'Webinar'], ['S. Kim', 'Referral']]],
    ['Qualification', 7, [['N. Brooks', 'Form'], ['D. Ali', 'Call']]],
    ['Activated', 6, [['P. Nguyen', 'FSM'], ['C. Ruiz', 'Disseminator']]],
    ['First activity', 5, [['E. Johansson', 'Lecture'], ['H. Wong', 'Invite']]],
    ['Retained', 6, [['F. Berg', '30 d+'], ['Y. Sato', '60 d+']]]
  ];

  if (cols.length === 0) return emptyPanel('No candidates in the funnel.');

  let html = '<div class="fc-stat-cards">';
  stats.forEach((s) => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div>' +
      '<div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div>' +
      '<div class="text-muted" style="font-size:11.5px;margin-top:4px">' + esc(s[2]) + '</div></div>';
  });
  html += '</div><div class="fc-pipeline">';
  cols.forEach((c) => {
    html += '<div class="fc-pipe-col"><div class="fc-pipe-head">' + esc(c[0]) + '</div>' +
      '<div class="fc-pipe-count">' + c[1] + ' candidates</div>';
    c[2].forEach((cand) => {
      html += '<div class="fc-cand"><div>' + esc(cand[0]) + '</div><div class="fc-cand-meta">' + esc(cand[1]) + '</div></div>';
    });
    html += '</div>';
  });
  html += '</div><h4 style="margin:8px 0 12px">Orientation webinars</h4>' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Session</th><th>Registered</th><th>Attended</th><th>Qualified</th><th>Activated</th></tr></thead><tbody>' +
    '<tr class="fc-row"><td>12 Aug — Intro to field work</td><td class="fc-tnum">28</td><td class="fc-tnum">21</td><td class="fc-tnum">14</td><td class="fc-tnum">9</td></tr>' +
    '<tr class="fc-row"><td>5 Aug — Responsibilities & support</td><td class="fc-tnum">19</td><td class="fc-tnum">15</td><td class="fc-tnum">11</td><td class="fc-tnum">7</td></tr>' +
    '<tr class="fc-row"><td>22 Jul — Path to activation</td><td class="fc-tnum">24</td><td class="fc-tnum">17</td><td class="fc-tnum">12</td><td class="fc-tnum">8</td></tr>' +
    '</tbody></table>';
  return html;
}

export function mount() {}

export function unmount() {}
