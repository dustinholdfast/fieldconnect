import {
  SCREENS, ROLE_SCREENS, ROLES, CONTACTS, PATHWAYS, JOURNEYS,
  COURSES, STAGE_ORDER, STORY_BASE, APPTS, MAPPING, IMPORTS, ORGS, ROLES_TABLE
} from './data.js';
import { api, setCsrfToken } from './api.js';
import { mount as mountLogin, render as renderLogin } from './screens/login.js';

const ACCENT = '#b68235';
const OK = '#5f7a4a';
const WARN = '#a06f24';
const BAD = '#8c4a3a';

const state = {
  role: 'manager',
  user: null,
  org: null,
  screen: 'dashboard',
  contactIdx: 0,
  stageFilter: 'All',
  crmQuery: '',
  journeyId: 'j1',
  uploadStep: 1,
  track: 'FSM',
  adapterOn: false,
  submitted: false,
  storyStages: {},
  o: {
    delivered: 'yes', duration: '46', result: 'Qualified', channel: 'Email',
    ruinCat: '', desired: '', ruinNotes: '', pathway: '',
    books: '1', bookValue: '25', seminars: '0', semValue: '50',
    next: '', due: '', objection: '', storySignal: 'No',
    consent0: true, consent1: false, consent2: false
  }
};

function setState(partial) {
  Object.assign(state, partial);
  render();
}

function setO(key, value) {
  state.o = { ...state.o, [key]: value };
  state.submitted = false;
  render();
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusColor(s) {
  if (s === 'ok') return OK;
  if (s === 'warn') return WARN;
  if (s === 'bad') return BAD;
  if (s === 'accent') return '#7d5411';
  return 'inherit';
}

function render() {
  const role = ROLES.find(r => r.id === state.role) || ROLES[0];
  const allowed = ROLE_SCREENS[state.role] || ROLE_SCREENS.fsm;
  let screenId = allowed.includes(state.screen) ? state.screen : allowed[0];
  if (state.screen !== screenId) state.screen = screenId;
  const screen = SCREENS.find(s => s.id === screenId);
  const user = state.user || {};
  const orgName = (state.org && state.org.name) || 'Church of Scientology of Twin Cities';

  const navItems = SCREENS
    .filter(s => allowed.includes(s.id))
    .map((s, i) => {
      const active = s.id === screenId;
      return '<div class="fc-nav-item ' + (active ? 'active' : '') + '" data-go="' + s.id + '">' +
        '<span class="fc-nav-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span>' + esc(s.label) + '</span></div>';
    }).join('');

  const content = renderScreen(screenId);
  const root = document.getElementById('app');
  root.className = 'fc-root';
  root.innerHTML =
    '<aside class="fc-sidebar">' +
      '<div class="fc-brand">' +
        '<div class="fc-brand-name">FieldConnect</div>' +
        '<div class="fc-brand-kicker">Event → Field Conversion</div>' +
      '</div>' +
      '<nav class="fc-nav">' + navItems + '</nav>' +
      '<div class="fc-sidebar-footer">' +
        '<div class="fc-org-name">' + esc(orgName) + '</div>' +
        '<div class="fc-sync">MetaPulse sync — ' + (state.adapterOn ? 'API adapter live' : 'file exchange') + '</div>' +
      '</div>' +
    '</aside>' +
    '<div class="fc-main">' +
      '<header class="fc-header">' +
        '<div class="fc-header-left">' +
          '<div class="kicker">' + esc(screen.kicker) + '</div>' +
          '<h2>' + esc(screen.title) + '</h2>' +
        '</div>' +
        '<div class="fc-header-right">' +
          '<div class="fc-user-chip">' +
            '<div class="fc-avatar">' + esc(user.initials || role.initials) + '</div>' +
            '<div class="fc-user-meta">' +
              '<div class="fc-user-name">' + esc(user.displayName || role.name) + '</div>' +
              '<div class="fc-user-role">' + esc(role.full) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<div class="fc-content">' + content + '</div>' +
    '</div>';

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-go]').forEach(el => {
    el.addEventListener('click', () => setState({ screen: el.dataset.go }));
  });
  const search = document.getElementById('crm-search');
  if (search) search.addEventListener('input', e => setState({ crmQuery: e.target.value }));
  document.querySelectorAll('[data-stage]').forEach(el => {
    el.addEventListener('click', () => setState({ stageFilter: el.dataset.stage }));
  });
  document.querySelectorAll('[data-contact]').forEach(el => {
    el.addEventListener('click', () => setState({ contactIdx: +el.dataset.contact }));
  });
  const goOutcome = document.getElementById('go-outcome');
  if (goOutcome) goOutcome.addEventListener('click', () => setState({ screen: 'outcome' }));
  document.querySelectorAll('[data-journey]').forEach(el => {
    el.addEventListener('click', () => setState({ journeyId: el.dataset.journey }));
  });
  document.querySelectorAll('[data-step]').forEach(el => {
    el.addEventListener('click', () => setState({ uploadStep: +el.dataset.step }));
  });
  const nextStep = document.getElementById('next-step');
  if (nextStep) nextStep.addEventListener('click', () => setState({ uploadStep: Math.min(4, state.uploadStep + 1) }));
  const prevStep = document.getElementById('prev-step');
  if (prevStep) prevStep.addEventListener('click', () => setState({ uploadStep: Math.max(1, state.uploadStep - 1) }));
  document.querySelectorAll('[data-track]').forEach(el => {
    el.addEventListener('click', () => setState({ track: el.dataset.track }));
  });
  document.querySelectorAll('[data-advance]').forEach(el => {
    el.addEventListener('click', () => {
      const i = +el.dataset.advance;
      const current = state.storyStages[i] || STORY_BASE[i][3];
      const idx = STAGE_ORDER.indexOf(current);
      const next = STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
      setState({ storyStages: { ...state.storyStages, [i]: next } });
    });
  });
  const adapterBtn = document.getElementById('toggle-adapter');
  if (adapterBtn) adapterBtn.addEventListener('click', () => setState({ adapterOn: !state.adapterOn }));
  document.querySelectorAll('[data-o]').forEach(el => {
    const key = el.dataset.o;
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => setO(key, el.checked));
    } else {
      el.addEventListener('change', () => setO(key, el.value));
      el.addEventListener('input', () => setO(key, el.value));
    }
  });
  document.querySelectorAll('[data-pathway]').forEach(el => {
    el.addEventListener('click', () => setO('pathway', el.dataset.pathway));
  });
  const submit = document.getElementById('submit-outcome');
  if (submit) submit.addEventListener('click', () => setState({ submitted: true }));
  const reset = document.getElementById('reset-outcome');
  if (reset) reset.addEventListener('click', () => {
    state.o = {
      delivered: 'yes', duration: '', result: '', channel: 'Email',
      ruinCat: '', desired: '', ruinNotes: '', pathway: '',
      books: '0', bookValue: '0', seminars: '0', semValue: '0',
      next: '', due: '', objection: '', storySignal: 'No',
      consent0: false, consent1: false, consent2: false
    };
    setState({ submitted: false });
  });
}

function renderScreen(id) {
  switch (id) {
    case 'dashboard': return renderDashboard();
    case 'crm': return renderCrm();
    case 'scheduling': return renderScheduling();
    case 'outcome': return renderOutcome();
    case 'nurture': return renderNurture();
    case 'lists': return renderLists();
    case 'training': return renderTraining();
    case 'recruitment': return renderRecruitment();
    case 'stories': return renderStories();
    case 'admin': return renderAdmin();
    default: return '<p>Screen not found</p>';
  }
}

function renderDashboard() {
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

function renderCrm() {
  const stages = ['All', 'Registered', 'Attended', 'Scheduled', 'Completed', 'No-show'];
  const q = state.crmQuery.trim().toLowerCase();
  let visible = CONTACTS.map((c, i) => ({ c, i }))
    .filter(x => state.stageFilter === 'All' || x.c.stage === state.stageFilter)
    .filter(x => !q || (x.c.name + ' ' + x.c.email).toLowerCase().includes(q));
  if (state.role === 'fsm') visible = visible.filter(x => x.c.fsm === 'D. Whitfield');
  const sel = CONTACTS[state.contactIdx] || CONTACTS[0];

  let html = '<div class="fc-two-col"><section><div class="fc-toolbar">' +
    '<input id="crm-search" class="input fc-search" type="search" placeholder="Search name or email…" value="' + esc(state.crmQuery) + '" />' +
    '<div class="fc-seg">';
  stages.forEach(s => {
    html += '<button class="fc-seg-btn ' + (s === state.stageFilter ? 'active' : '') + '" data-stage="' + esc(s) + '">' + esc(s) + '</button>';
  });
  html += '</div><div class="fc-count">' + visible.length + ' of ' + CONTACTS.length + ' contacts</div></div>' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contact</th><th>Source</th><th>Last event</th><th>Stage</th><th>Consent</th><th>FSM</th></tr></thead><tbody>';
  visible.forEach(x => {
    html += '<tr class="fc-row ' + (x.i === state.contactIdx ? 'selected' : '') + '" data-contact="' + x.i + '" style="cursor:pointer">' +
      '<td><div>' + esc(x.c.name) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(x.c.email) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(x.c.source) + '</td>' +
      '<td style="font-size:12.5px">' + esc(x.c.event) + '</td>' +
      '<td><span class="tag tag-outline" style="font-size:11px">' + esc(x.c.stage) + '</span></td>' +
      '<td style="font-size:12.5px">' + esc(x.c.consent) + '</td>' +
      '<td style="font-size:12.5px">' + esc(x.c.fsm) + '</td></tr>';
  });
  html += '</tbody></table></section>' +
    '<aside class="fc-panel" style="position:sticky;top:0">' +
    '<div class="fc-section-title">Contact record</div>' +
    '<h4 style="margin:6px 0 2px;font-size:22px">' + esc(sel.name) + '</h4>' +
    '<div class="text-muted" style="font-size:12.5px">' + esc(sel.email) + ' · ' + esc(sel.phone) + '</div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div style="display:grid;grid-template-columns:96px 1fr;gap:7px 12px;font-size:12.5px">' +
    '<span class="text-muted">Lifecycle</span><span>' + esc(sel.stage) + '</span>' +
    '<span class="text-muted">Source</span><span>' + esc(sel.source) + '</span>' +
    '<span class="text-muted">Ruin</span><span>' + esc(sel.ruin) + '</span>' +
    '<span class="text-muted">Assigned FSM</span><span>' + esc(sel.fsm) + '</span>' +
    '<span class="text-muted">Consent</span><span>' + esc(sel.consent) + '</span>' +
    '<span class="text-muted">Journey</span><span>' + esc(sel.journey) + '</span></div>' +
    '<hr class="hr" style="margin:16px 0" />' +
    '<div class="fc-section-title" style="margin-bottom:10px">Activity history</div>';
  sel.history.forEach(h => {
    html += '<div class="fc-history-row"><span class="fc-history-date">' + esc(h[0]) + '</span><span>' + esc(h[1]) + '</span></div>';
  });
  html += '<div style="display:flex;gap:8px;margin-top:18px">' +
    '<button class="btn btn-primary" id="go-outcome">Open outcome form</button>' +
    '<button class="btn btn-secondary">Send link</button></div></aside></div>';
  return html;
}

function renderScheduling() {
  const stats = [['Booked this week', '23'], ['Confirmed', '19'], ['Awaiting outcome form', '7'], ['No-show rate (30 d)', '14%']];
  const slots = ['9:00','10:00','11:00','1:00','2:00','3:00','4:00','5:00','6:30','7:30','9:00','10:00','11:00','1:00','2:00','3:00','4:00','5:00','6:30','7:30'];
  const bookedIdx = [2, 5, 8, 11, 16];

  let html = '<div class="fc-stat-cards">';
  stats.forEach(s => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><div class="fc-two-col-sched"><section><h4 style="margin-bottom:10px">Appointment queue</h4>' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>When</th><th>Attendee</th><th>FSM</th><th>Status</th><th>Action due</th></tr></thead><tbody>';
  APPTS.forEach(a => {
    html += '<tr class="fc-row"><td><div class="fc-tnum">' + esc(a[0]) + '</div><div class="text-muted" style="font-size:11px">' + esc(a[1]) + '</div></td>' +
      '<td><div>' + esc(a[2]) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(a[3]) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(a[4]) + '</td>' +
      '<td><span style="color:' + statusColor(a[6]) + ';font-size:12.5px">' + esc(a[5]) + '</span></td>' +
      '<td style="font-size:12.5px">' + esc(a[7]) + '</td></tr>';
  });
  html += '</tbody></table></section><aside class="fc-panel">' +
    '<div class="fc-section-title">Availability (canonical)</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:12.5px;margin:12px 0 16px">' +
    '<span class="text-muted">Working hours</span><span>09:00–19:00</span>' +
    '<span class="text-muted">Time zone</span><span>America/Chicago</span>' +
    '<span class="text-muted">Duration</span><span>45 minutes</span>' +
    '<span class="text-muted">Buffer</span><span>15 minutes</span>' +
    '<span class="text-muted">Min notice</span><span>12 hours</span>' +
    '<span class="text-muted">Max per day</span><span>4</span></div>' +
    '<div class="text-muted" style="font-size:12px;margin-bottom:8px">Week slots · only free/busy exposed publicly</div>' +
    '<div class="fc-slots">';
  slots.forEach((t, i) => {
    html += '<div class="fc-slot ' + (bookedIdx.includes(i) ? 'booked' : '') + '">' + t + '</div>';
  });
  html += '</div></aside></div>';
  return html;
}

function renderOutcome() {
  const o = state.o;
  const rev = (parseFloat(o.books || 0) * parseFloat(o.bookValue || 0)) +
              (parseFloat(o.seminars || 0) * parseFloat(o.semValue || 0));
  const journeyForOutcome = o.delivered === 'no' ? 'No-show recovery'
    : parseFloat(o.seminars || 0) > 0 ? 'DN Seminar buyer'
    : parseFloat(o.books || 0) > 0 ? 'Book buyer'
    : o.result === 'Not a fit' ? 'Interested but unqualified' : 'Completed, no book';
  const pathwayList = PATHWAYS[o.ruinCat] || [];
  const sel = CONTACTS[state.contactIdx] || CONTACTS[0];

  let html = '<div class="fc-two-col-outcome"><section class="fc-panel" style="padding:24px 26px">' +
    '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
    '<h4 style="font-size:23px;margin:0">' + esc(sel.name) + '</h4>' +
    '<span class="text-muted" style="font-size:12.5px">27 Aug 2026 · Dianetics #47</span></div>' +
    '<hr class="hr" style="margin:14px 0" />' +
    '<div class="fc-section-title">Attendance & result</div>' +
    '<div class="fc-form-grid" style="margin-bottom:18px">' +
    '<div class="fc-field"><label>Interview delivered</label><select data-o="delivered">' +
    '<option value="yes"' + (o.delivered==='yes'?' selected':'') + '>Yes</option>' +
    '<option value="no"' + (o.delivered==='no'?' selected':'') + '>No — attendee not present</option>' +
    '<option value="partial"' + (o.delivered==='partial'?' selected':'') + '>Partial</option></select></div>' +
    '<div class="fc-field"><label>Actual duration (minutes)</label>' +
    '<input type="text" data-o="duration" value="' + esc(o.duration) + '" /></div>' +
    '<div class="fc-field"><label>Appointment result</label><select data-o="result">' +
    '<option value="">—</option>' +
    ['Qualified','Follow-up required','Not a fit','Reschedule requested','Declined'].map(v =>
      '<option value="' + v + '"' + (o.result===v?' selected':'') + '>' + v + '</option>'
    ).join('') +
    '</select></div>' +
    '<div class="fc-field"><label>Preferred contact method</label><select data-o="channel">' +
    ['Email','Phone','WhatsApp','Signal'].map(v =>
      '<option value="' + v + '"' + (o.channel===v?' selected':'') + '>' + v + '</option>'
    ).join('') +
    '</select></div></div>' +
    '<div class="fc-section-title">Ruin</div>' +
    '<div class="fc-form-grid" style="margin-bottom:10px">' +
    '<div class="fc-field"><label>Ruin category</label><select data-o="ruinCat">' +
    '<option value="">— select —</option>';
  Object.keys(PATHWAYS).forEach(k => {
    html += '<option value="' + esc(k) + '"' + (o.ruinCat===k?' selected':'') + '>' + esc(k) + '</option>';
  });
  html += '</select></div>' +
    '<div class="fc-field"><label>Desired improvement</label>' +
    '<input type="text" data-o="desired" value="' + esc(o.desired) + '" placeholder="In their words" /></div></div>' +
    '<div class="fc-field" style="margin-bottom:16px"><label>Notes — record what they said, not an interpretation</label>' +
    '<textarea data-o="ruinNotes" rows="2">' + esc(o.ruinNotes) + '</textarea></div>';

  if (o.ruinCat) {
    html += '<div class="fc-accent-panel"><div class="fc-section-title" style="margin-bottom:8px">Approved Dianetics pathway for “' + esc(o.ruinCat) + '”</div>' +
      '<p class="text-muted" style="font-size:12px;margin-bottom:12px">The system offers Church-approved options only; the FSM chooses; nothing is auto-recommended.</p>';
    pathwayList.forEach(p => {
      html += '<div class="fc-pathway ' + (o.pathway===p[0]?'selected':'') + '" data-pathway="' + esc(p[0]) + '">' +
        '<span>' + esc(p[0]) + '</span><span class="text-muted" style="font-size:12px">' + esc(p[1]) + '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="fc-section-title" style="margin-top:18px">Product results</div>' +
    '<div class="fc-form-grid" style="margin-bottom:16px">' +
    '<div class="fc-field"><label>Books sold</label><input type="number" data-o="books" value="' + esc(o.books) + '" min="0" /></div>' +
    '<div class="fc-field"><label>Book value (USD)</label><input type="number" data-o="bookValue" value="' + esc(o.bookValue) + '" min="0" /></div>' +
    '<div class="fc-field"><label>DN Seminars sold</label><input type="number" data-o="seminars" value="' + esc(o.seminars) + '" min="0" /></div>' +
    '<div class="fc-field"><label>Seminar value (USD)</label><input type="number" data-o="semValue" value="' + esc(o.semValue) + '" min="0" /></div></div>' +
    '<div class="fc-section-title">Follow-up & qual</div>' +
    '<div class="fc-form-grid" style="margin-bottom:16px">' +
    '<div class="fc-field"><label>Next action</label><input type="text" data-o="next" value="' + esc(o.next) + '" /></div>' +
    '<div class="fc-field"><label>Due date</label><input type="date" data-o="due" value="' + esc(o.due) + '" /></div>' +
    '<div class="fc-field"><label>Objection category</label><select data-o="objection"><option value="">—</option>' +
    ['Cost','Time','Scepticism about results','Needs family agreement','Escalation needed'].map(v =>
      '<option value="' + v + '"' + (o.objection===v?' selected':'') + '>' + v + '</option>'
    ).join('') +
    '</select></div>' +
    '<div class="fc-field"><label>Success-story signal</label><select data-o="storySignal">' +
    ['No','Possible','Strong'].map(v =>
      '<option value="' + v + '"' + (o.storySignal===v?' selected':'') + '>' + v + '</option>'
    ).join('') +
    '</select></div></div>' +
    '<div class="fc-section-title">Consent</div>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent0"' + (o.consent0?' checked':'') + ' /> Permission to contact for follow-up</label>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent1"' + (o.consent1?' checked':'') + ' /> Permission to request a testimonial</label>' +
    '<label class="fc-check"><input type="checkbox" data-o="consent2"' + (o.consent2?' checked':'') + ' /> Permission to use the story publicly</label>' +
    '<div style="display:flex;gap:10px;margin-top:20px">' +
    '<button class="btn btn-primary" id="submit-outcome">Submit</button>' +
    '<button class="btn btn-secondary" id="reset-outcome">Clear</button></div>' +
    '<div class="fc-submit-note ' + (state.submitted?'success':'') + '">' +
    (state.submitted
      ? 'Submitted — appointment closed, follow-up task created, reporting queued.'
      : 'Mobile-friendly; may be completed on a phone straight after the interview.') +
    '</div></section>' +
    '<aside class="fc-derived"><div class="fc-section-title">Recorded on submit</div>' +
    '<div class="fc-derived-row"><span class="text-muted">Appointment status</span><span>' + (o.delivered==='no'?'No-show':'Completed') + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Ruin → pathway</span><span>' + esc(o.pathway || (o.ruinCat ? 'not selected' : '—')) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Revenue</span><span class="fc-tnum">$' + (isNaN(rev)?0:rev.toFixed(0)) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Journey entered</span><span>' + esc(journeyForOutcome) + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">Follow-up task</span><span>' + esc(o.next ? o.next + (o.due ? ' · ' + o.due : '') : 'none set') + '</span></div>' +
    '<div class="fc-derived-row"><span class="text-muted">MetaPulse points</span><span>' + (state.adapterOn ? '6 queued to API' : '6 queued to file export') + '</span></div>' +
    '<hr class="hr" style="margin:14px 0" />' +
    '<p class="text-muted" style="font-size:12px">Preparation notes and an immutable audit statement are written on submit. Nothing is auto-recommended; the FSM retains control.</p>' +
    '</aside></div>';
  return html;
}

function renderNurture() {
  const journey = JOURNEYS.find(j => j.id === state.journeyId) || JOURNEYS[0];
  let html = '<div class="fc-two-col-nurture"><aside>';
  JOURNEYS.forEach(j => {
    html += '<div class="fc-journey-card ' + (j.id===state.journeyId?'selected':'') + '" data-journey="' + j.id + '">' +
      '<div style="font-size:14px;font-weight:600">' + esc(j.name) + '</div>' +
      '<div class="text-muted" style="font-size:12px;margin-top:3px">' + esc(j.entry) + '</div>' +
      '<div style="font-size:12px;margin-top:6px;color:var(--color-accent-700)">' + esc(j.enrolled) + '</div></div>';
  });
  html += '</aside><section><h4 style="margin-bottom:4px">' + esc(journey.name) + '</h4>' +
    '<p class="text-muted" style="font-size:13px;margin-bottom:16px">Objective: ' + esc(journey.objective) + '</p>' +
    '<div class="fc-stat-cards" style="grid-template-columns:repeat(3,1fr)">';
  journey.stats.forEach(s => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum" style="font-size:20px">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr>' +
    '<th style="width:130px">Timing</th><th>Step</th><th style="width:150px">Channel</th><th style="width:92px;text-align:right">Engagement</th></tr></thead><tbody>';
  journey.steps.forEach(s => {
    html += '<tr class="fc-row"><td style="color:var(--color-accent-700);font-size:12.5px">' + esc(s[0]) + '</td>' +
      '<td><div style="font-weight:600">' + esc(s[1]) + '</div><div class="text-muted" style="font-size:12px">' + esc(s[2]) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s[3]) + '</td>' +
      '<td class="fc-tnum" style="text-align:right;font-size:12.5px">' + esc(s[4]) + '</td></tr>';
  });
  html += '</tbody></table><p class="text-muted" style="font-size:12.5px;margin-top:16px">Exit: ' + esc(journey.exit) +
    '. Quiet hours 9 PM–8 AM local. Immediate opt-out suppression on every channel.</p></section></div>';
  return html;
}

function renderLists() {
  const steps = ['Upload file', 'Map fields', 'Validate', 'Activate'];
  let html = '<div class="fc-stepper">';
  steps.forEach((l, i) => {
    html += '<div class="fc-step ' + (state.uploadStep===i+1?'active':'') + '" data-step="' + (i+1) + '">' +
      '<div class="fc-step-num">Step ' + (i+1) + '</div><div>' + esc(l) + '</div></div>';
  });
  html += '</div>';

  if (state.uploadStep === 1) {
    html += '<div class="fc-dropzone"><div style="font-size:15px;margin-bottom:8px">Drop a CSV or XLSX file here</div>' +
      '<div class="text-muted" style="font-size:13px">or click to browse · max 50 MB</div>' +
      '<div style="margin-top:16px;font-size:13px">spring-open-house-2026.csv · 1,284 rows · 86 KB</div></div>' +
      '<button class="btn btn-primary" id="next-step">Continue to field mapping</button>';
  }
  if (state.uploadStep === 2) {
    html += '<table class="table" style="width:100%;font-size:13px;margin-bottom:16px"><thead><tr>' +
      '<th>Column in file</th><th>Sample value</th><th>Maps to</th><th>Status</th></tr></thead><tbody>';
    MAPPING.forEach(m => {
      html += '<tr class="fc-row"><td class="fc-tnum">' + esc(m[0]) + '</td><td>' + esc(m[1]) + '</td>' +
        '<td>' + esc(m[2]) + '</td><td><span style="color:' + statusColor(m[4]) + '">' + esc(m[3]) + '</span></td></tr>';
    });
    html += '</tbody></table><div style="display:flex;gap:10px">' +
      '<button class="btn btn-secondary" id="prev-step">Back</button>' +
      '<button class="btn btn-primary" id="next-step">Continue to validation</button></div>';
  }
  if (state.uploadStep === 3) {
    const vals = [['1,284','Rows read','inherit'],['1,197','Valid contacts',OK],['62','Duplicates merged',WARN],['19','Suppressed (opted out)',WARN],['6','Rejected — invalid email',BAD]];
    html += '<div class="fc-val-grid">';
    vals.forEach(v => {
      html += '<div class="fc-val-card"><div class="fc-val-n fc-tnum" style="color:' + v[2] + '">' + esc(v[0]) + '</div>' +
        '<div class="fc-val-label">' + esc(v[1]) + '</div></div>';
    });
    html += '</div><div class="fc-panel" style="margin-bottom:16px"><div class="fc-section-title">Lawful basis and labelling</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;font-size:13px;margin-top:10px">' +
      '<span class="text-muted">Source label</span><span>Spring open house 2026 sign-up sheets</span>' +
      '<span class="text-muted">List owner</span><span>A. Reyes (Campaign manager)</span>' +
      '<span class="text-muted">Communication basis</span><span>Legitimate interest — public event follow-up · opt-out respected</span></div></div>' +
      '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step">Back</button>' +
      '<button class="btn btn-primary" id="next-step">Continue to activate</button></div>';
  }
  if (state.uploadStep === 4) {
    html += '<div class="fc-panel" style="margin-bottom:20px"><div class="fc-section-title">Ready to activate</div>' +
      '<p style="font-size:14px;margin:10px 0">1,197 valid contacts will enter the <strong>Div 6 lecture invitation</strong> journey. 19 suppressed against global opt-out. 6 rejected for invalid email.</p>' +
      '<p class="text-muted" style="font-size:13px">Activation is irreversible for this import batch. You can still suppress individual contacts later.</p></div>' +
      '<div style="display:flex;gap:10px"><button class="btn btn-secondary" id="prev-step">Back</button>' +
      '<button class="btn btn-primary">Activate list</button></div>';
  }

  html += '<h4 style="margin:36px 0 12px">Import history</h4>' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>File</th><th>Uploaded</th><th>Rows</th><th>Active</th><th>Suppressed</th><th>Status</th></tr></thead><tbody>';
  IMPORTS.forEach(i => {
    html += '<tr class="fc-row"><td>' + esc(i[0]) + '</td><td class="fc-tnum">' + esc(i[1]) + '</td>' +
      '<td class="fc-tnum">' + esc(i[2]) + '</td><td class="fc-tnum">' + esc(i[3]) + '</td>' +
      '<td class="fc-tnum">' + esc(i[4]) + '</td><td style="font-size:12.5px">' + esc(i[5]) + '</td></tr>';
  });
  html += '</tbody></table>';
  return html;
}

function renderTraining() {
  const tracks = ['Host', 'FSM', 'Qual handling', 'Campaign manager', 'Disseminator', 'Recruiter', 'Success line'];
  const courses = COURSES[state.track] || [];
  const quals = [['FSM track','3 of 6 complete',WARN],['Supervisor sign-off','Pending',WARN],['Refresher due','14 Feb 2027','inherit'],['Appointment routing','Enabled (provisional)',OK]];

  let html = '<div class="fc-tracks">';
  tracks.forEach(t => {
    html += '<button class="fc-track-chip ' + (t===state.track?'active':'') + '" data-track="' + esc(t) + '">' + esc(t) + '</button>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 280px;gap:28px;align-items:start"><div class="fc-course-grid">';
  courses.forEach(c => {
    html += '<div class="card"><div class="card-kicker">' + esc(state.track) + '</div>' +
      '<div class="card-title">' + esc(c[0]) + '</div><p class="card-body">' + esc(c[1]) + '</p>' +
      '<div class="fc-progress"><div class="fc-progress-bar" style="width:' + esc(c[2]) + '"></div></div>' +
      '<div class="card-meta"><span>' + esc(c[3]) + '</span>' +
      '<span style="margin-left:auto;color:' + statusColor(c[5]) + '">' + esc(c[4]) + '</span></div></div>';
  });
  html += '</div><aside class="fc-panel"><div class="fc-section-title">Qualification status</div>';
  quals.forEach(q => {
    html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-divider);font-size:13px">' +
      '<span class="text-muted">' + esc(q[0]) + '</span><span style="color:' + q[2] + '">' + esc(q[1]) + '</span></div>';
  });
  html += '<p class="text-muted" style="font-size:12.5px;margin-top:16px">Appointment routing is withheld until the FSM track is complete and signed off.</p></aside></div>';
  return html;
}

function renderRecruitment() {
  const stats = [
    ['Candidates in funnel','64','across 3 Churches'],
    ['Orientation attendance','71%','+6 pts vs last wave'],
    ['Activation rate','38%','of orientation attendees'],
    ['Median time to first activity','11 d','target: 14 d']
  ];
  const cols = [
    ['Prospect',12,[['A. Mensah','Referral'],['L. Park','Social']]],
    ['Interested',9,[['K. Voss','Email'],['T. Okoro','Referral']]],
    ['Orient. registered',11,[['M. Silva','Webinar'],['J. Cho','Referral']]],
    ['Orient. attended',8,[['R. Patel','Webinar'],['S. Kim','Referral']]],
    ['Qualification',7,[['N. Brooks','Form'],['D. Ali','Call']]],
    ['Activated',6,[['P. Nguyen','FSM'],['C. Ruiz','Disseminator']]],
    ['First activity',5,[['E. Johansson','Lecture'],['H. Wong','Invite']]],
    ['Retained',6,[['F. Berg','30 d+'],['Y. Sato','60 d+']]]
  ];

  let html = '<div class="fc-stat-cards">';
  stats.forEach(s => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div>' +
      '<div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div>' +
      '<div class="text-muted" style="font-size:11.5px;margin-top:4px">' + esc(s[2]) + '</div></div>';
  });
  html += '</div><div class="fc-pipeline">';
  cols.forEach(c => {
    html += '<div class="fc-pipe-col"><div class="fc-pipe-head">' + esc(c[0]) + '</div>' +
      '<div class="fc-pipe-count">' + c[1] + ' candidates</div>';
    c[2].forEach(cand => {
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

function renderStories() {
  const stageCounts = [['Submitted','12'],['Screened','6'],['Recorded','4'],['Consent pending','3'],['Published','9']];
  const stories = STORY_BASE.map((s, i) => {
    const stage = state.storyStages[i] || s[3];
    const nextIdx = Math.min(STAGE_ORDER.indexOf(stage) + 1, STAGE_ORDER.length - 1);
    const next = STAGE_ORDER[nextIdx];
    const releaseColor = s[4].includes('Not requested') ? WARN : OK;
    return { who: s[0], src: s[1], summary: s[2], stage, release: s[4], releaseColor, next, i };
  });

  let html = '<div class="fc-stage-cards">';
  stageCounts.forEach(s => {
    html += '<div class="fc-stat-card"><div class="fc-stat-label">' + esc(s[0]) + '</div><div class="fc-stat-value fc-tnum">' + esc(s[1]) + '</div></div>';
  });
  html += '</div><div style="display:grid;grid-template-columns:1fr 300px;gap:28px;align-items:start">' +
    '<table class="table" style="width:100%;font-size:13px"><thead><tr>' +
    '<th>Contributor</th><th>Story summary</th><th>Stage</th><th>Release</th><th></th></tr></thead><tbody>';
  stories.forEach(s => {
    html += '<tr class="fc-row"><td><div>' + esc(s.who) + '</div><div class="text-muted" style="font-size:11.5px">' + esc(s.src) + '</div></td>' +
      '<td style="font-size:12.5px">' + esc(s.summary) + '</td>' +
      '<td><span class="tag tag-outline" style="font-size:11px">' + esc(s.stage) + '</span></td>' +
      '<td style="color:' + s.releaseColor + ';font-size:12.5px">' + esc(s.release) + '</td>' +
      '<td><button class="btn btn-ghost" data-advance="' + s.i + '" style="font-size:12px">Advance → ' + esc(s.next) + '</button></td></tr>';
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

function renderAdmin() {
  let html = '<h4 style="margin-bottom:12px">Organizations</h4>' +
    '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Church</th><th>Wave</th><th>Users</th><th>Contacts</th><th>MetaPulse map</th><th>Status</th></tr></thead><tbody>';
  ORGS.forEach(o => {
    html += '<tr class="fc-row"><td>' + esc(o[0]) + '</td><td>' + esc(o[1]) + '</td>' +
      '<td class="fc-tnum">' + esc(o[2]) + '</td><td class="fc-tnum">' + esc(o[3]) + '</td>' +
      '<td>' + esc(o[4]) + '</td><td>' + esc(o[5]) + '</td></tr>';
  });
  html += '</tbody></table><h4 style="margin-bottom:12px">Roles and permissions</h4>' +
    '<table class="table" style="width:100%;font-size:13px;margin-bottom:28px"><thead><tr>' +
    '<th>Role</th><th>Scope</th><th>Key restriction</th></tr></thead><tbody>';
  ROLES_TABLE.forEach(r => {
    html += '<tr class="fc-row"><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td style="font-size:12.5px">' + esc(r[2]) + '</td></tr>';
  });
  html += '</tbody></table><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">' +
    '<div class="fc-panel"><div class="fc-section-title">MetaPulse integration</div>' +
    '<div style="font-size:13px;margin-top:12px">' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 1 — File exchange <span style="float:right;color:' + OK + '">Active</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 2 — API adapter <span style="float:right;color:' + (state.adapterOn ? OK : WARN) + '">' + (state.adapterOn ? 'Live' : 'Staged') + '</span></div>' +
    '<div style="padding:8px 0;border-bottom:1px solid var(--color-divider)">Level 3 — Nightly reconciliation (02:00 CT)</div>' +
    '<div style="padding:8px 0">Least-privilege API user · credentials owned by the non-profit</div></div>' +
    '<button class="btn btn-primary" id="toggle-adapter" style="margin-top:14px">' +
    (state.adapterOn ? 'Switch to file exchange' : 'Activate API adapter') + '</button></div>' +
    '<div class="fc-panel"><div class="fc-section-title">Last reconciliation</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;font-size:13px">' +
    '<div><span class="text-muted">Records sent</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600">1,204</span></div>' +
    '<div><span class="text-muted">Accepted</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + OK + '">1,196</span></div>' +
    '<div><span class="text-muted">Rejected</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + BAD + '">5</span></div>' +
    '<div><span class="text-muted">Need correction</span><br><span class="fc-tnum" style="font-size:20px;font-family:var(--font-heading);font-weight:600;color:' + WARN + '">3</span></div></div>' +
    '<hr class="hr" style="margin:16px 0" /><div class="fc-section-title">Audit trail (recent)</div>' +
    '<div style="font-size:12.5px">' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">16 Aug 14:22 · M. Okafor · Activated API adapter for Twin Cities</div>' +
    '<div style="padding:6px 0;border-bottom:1px solid var(--color-divider)">15 Aug 09:11 · A. Reyes · Uploaded spring-open-house-2026.csv</div>' +
    '<div style="padding:6px 0">14 Aug 16:40 · System · Nightly reconciliation completed</div></div></div></div>';
  return html;
}

function applySession(payload) {
  setCsrfToken(payload.csrfToken);
  state.user = payload.user;
  state.org = payload.org;
  state.role = payload.user.role;
}

function safeNext(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) {
    return '/dashboard';
  }
  if (raw === '/login' || raw.startsWith('/login?')) return '/dashboard';
  return raw;
}

function screenFromPath(pathname, role) {
  const id = String(pathname || '/').replace(/^\//, '').split('/')[0] || 'dashboard';
  const allowed = ROLE_SCREENS[role] || [];
  if (allowed.includes(id)) return id;
  return allowed[0] || 'dashboard';
}

function showLogin() {
  const root = document.getElementById('app');
  root.className = 'fc-root fc-login-page';
  root.innerHTML = renderLogin();
  mountLogin(root, {
    onSuccess(payload) {
      applySession(payload);
      const next = safeNext(new URLSearchParams(location.search).get('next'));
      history.replaceState({}, '', next);
      state.screen = screenFromPath(location.pathname, state.role);
      render();
    },
  });
}

async function fetchMe() {
  try {
    const res = await api('/api/auth/me');
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function boot() {
  const onLogin = location.pathname === '/login';
  const me = await fetchMe();
  if (onLogin) {
    if (me) {
      applySession(me);
      history.replaceState({}, '', '/dashboard');
      state.screen = 'dashboard';
      render();
      return;
    }
    showLogin();
    return;
  }
  if (!me) {
    const next = location.pathname + location.search || '/dashboard';
    location.replace('/login?next=' + encodeURIComponent(next));
    return;
  }
  applySession(me);
  state.screen = screenFromPath(location.pathname, state.role);
  render();
}

boot();
