import { endAt, now } from '../clock.js';
import { withOrg } from '../db.js';

const OVERDUE_STATUSES = new Set(['Confirmed', 'Booked', 'Reminder due', 'Partial']);
const BOOKED_STATUSES = new Set([
  'Booked', 'Confirmed', 'Reminder due', 'Partial', 'Completed', 'No-show',
]);
const ATTENDED_STAGES = new Set([
  'Attended', 'Scheduled', 'Interested', 'Completed', 'No-show', 'Not a fit',
]);
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const ATTENTION = [
  {
    code: 'outcome_overdue',
    label: 'Outcome forms overdue > 48 h',
    href: '/scheduling?filter=outcome_overdue',
  },
  {
    code: 'followup_overdue',
    label: 'Follow-up tasks past due',
    href: '/crm?filter=followup_overdue',
  },
  {
    code: 'unconfirmed_24h',
    label: 'Appointments unconfirmed within 24 h',
    href: '/scheduling?filter=unconfirmed',
  },
  {
    code: 'no_lawful_basis',
    label: 'Contacts with no lawful basis recorded',
    href: '/crm?filter=no_lawful_basis',
  },
];

function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function fsmScope(session, alias = 'a') {
  if (session.role !== 'fsm') return { sql: '', params: [] };
  return { sql: ` AND ${alias}.fsm_user_id = ?`, params: [session.userId] };
}

function personScope(session) {
  if (session.role !== 'fsm') return { sql: '', params: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1 FROM assignments asg
       WHERE asg.org_id = p.org_id AND asg.person_id = p.id AND asg.user_id = ?
    )`,
    params: [session.userId],
  };
}

function outcomeIds(org, appointmentIds) {
  const set = new Set();
  if (!appointmentIds.length) return set;
  const ph = appointmentIds.map(() => '?').join(', ');
  const rows = org.all(
    `SELECT appointment_id FROM outcomes WHERE org_id = ? AND appointment_id IN (${ph})`,
    appointmentIds,
  );
  for (const row of rows) set.add(row.appointment_id);
  return set;
}

export function isOutcomeOverdue(appt, nowDate, hasOutcome) {
  if (hasOutcome) return false;
  if (!OVERDUE_STATUSES.has(appt.status)) return false;
  return endAt(appt).getTime() < nowDate.getTime() - 48 * MS_HOUR;
}

export function isUnconfirmed24h(appt, nowDate) {
  if (appt.status !== 'Booked') return false;
  const start = Date.parse(appt.start_at);
  if (!Number.isFinite(start)) return false;
  const t = nowDate.getTime();
  return start >= t && start - t <= 24 * MS_HOUR;
}

export function isFollowupPastDue(row, nowDate) {
  if (row.kind !== 'follow_up' || row.status !== 'open' || !row.due_at) return false;
  const due = Date.parse(row.due_at);
  if (!Number.isFinite(due)) return false;
  return due < nowDate.getTime();
}

function loadPeople(org, session) {
  const scope = personScope(session);
  return org.all(
    `SELECT p.id, p.stage, p.created_at, p.lawful_basis, p.suppressed, p.merged_into_id
       FROM people p
      WHERE p.org_id = ? AND p.merged_into_id IS NULL${scope.sql}`,
    scope.params,
  );
}

function loadAppointments(org, session) {
  const scope = fsmScope(session);
  return org.all(
    `SELECT a.id, a.person_id, a.fsm_user_id, a.start_at, a.duration_min, a.status
       FROM appointments a
      WHERE a.org_id = ?${scope.sql}`,
    scope.params,
  );
}

function loadFollowups(org, session) {
  if (session.role === 'fsm') {
    return org.all(
      `SELECT id, kind, status, due_at, user_id, person_id
         FROM assignments
        WHERE org_id = ? AND kind = 'follow_up' AND user_id = ?`,
      [session.userId],
    );
  }
  return org.all(
    `SELECT id, kind, status, due_at, user_id, person_id
       FROM assignments
      WHERE org_id = ? AND kind = 'follow_up'`,
  );
}

function loadLineItems(org, session) {
  const scope = fsmScope(session, 'o');
  return org.all(
    `SELECT oli.qty, pr.sku, o.fsm_user_id
       FROM outcomes o
       JOIN outcome_line_items oli ON oli.outcome_id = o.id
       JOIN products pr ON pr.id = oli.product_id AND pr.org_id = o.org_id
      WHERE o.org_id = ?${scope.sql}`,
    scope.params,
  );
}

function loadFsms(org) {
  return org.all(
    `SELECT id, display_name AS name
       FROM users
      WHERE org_id = ? AND role = 'fsm'
      ORDER BY id ASC`,
  );
}

function productCounts(lineItems, fsmUserId) {
  let books = 0;
  let seminars = 0;
  for (const row of lineItems) {
    if (fsmUserId != null && row.fsm_user_id !== fsmUserId) continue;
    const qty = Number(row.qty) || 0;
    if (row.sku === 'dn-book') books += qty;
    else if (row.sku === 'dn-seminar') seminars += qty;
  }
  return { books, seminars };
}

function dashboardPayload(org, session, nowDate) {
  const people = loadPeople(org, session);
  const appts = loadAppointments(org, session);
  const lineItems = loadLineItems(org, session);
  // Conversion table is always the three seeded FSMs with each member's own rows.
  const orgAppts = loadAppointments(org, { role: 'admin' });
  const orgLines = loadLineItems(org, { role: 'admin' });
  const weekAgo = nowDate.getTime() - 7 * MS_DAY;

  const registered = people.length;
  const attended = people.filter((p) => ATTENDED_STAGES.has(p.stage)).length;
  const interested = people.filter((p) => p.stage === 'Interested').length;
  const bookedPeople = new Set(
    appts.filter((a) => BOOKED_STATUSES.has(a.status)).map((a) => a.person_id),
  );
  const booked = bookedPeople.size;
  const completed = appts.filter((a) => a.status === 'Completed').length;
  const { books, seminars } = productCounts(lineItems);
  const weekNew = people.filter((p) => Date.parse(p.created_at) >= weekAgo).length;

  const kpis = [
    { key: 'registered', label: 'Registered', value: registered, delta: `+${weekNew} this week` },
    { key: 'attended', label: 'Attended', value: attended, delta: `${pct(attended, registered)} of registered` },
    { key: 'interested', label: 'Interested', value: interested, delta: `${pct(interested, attended)} of attendees` },
    { key: 'completed', label: 'Completed', value: completed, delta: `${pct(completed, booked)} of booked` },
    { key: 'books', label: 'Books sold', value: books, delta: `${pct(books, completed)} of completed` },
    { key: 'seminars', label: 'DN Seminars', value: seminars, delta: `${pct(seminars, completed)} of completed` },
  ];

  const funnel = [
    { key: 'invited', label: 'Invited (Div 6 + Meetup)', value: registered },
    { key: 'registered', label: 'Registered', value: registered },
    { key: 'attended', label: 'Attended', value: attended },
    { key: 'interested', label: 'Expressed interest', value: interested },
    { key: 'booked', label: 'Booked', value: booked },
    { key: 'completed', label: 'Completed', value: completed },
    { key: 'book_sold', label: 'Book sold', value: books },
    { key: 'seminar_sold', label: 'DN Seminar sold', value: seminars },
  ];

  const byFsm = loadFsms(org).map((fsm) => {
    const mine = orgAppts.filter((a) => a.fsm_user_id === fsm.id);
    const sold = productCounts(orgLines, fsm.id);
    return {
      fsmUserId: fsm.id,
      name: fsm.name,
      done: mine.filter((a) => a.status === 'Completed').length,
      noShow: mine.filter((a) => a.status === 'No-show').length,
      books: sold.books,
      seminars: sold.seminars,
    };
  });

  return { kpis, funnel, byFsm };
}

function attentionPayload(org, session, nowDate) {
  const appts = loadAppointments(org, session);
  const hasOutcome = outcomeIds(org, appts.map((a) => a.id));
  const followups = loadFollowups(org, session);
  const people = loadPeople(org, session);

  const counts = {
    outcome_overdue: appts.filter((a) => isOutcomeOverdue(a, nowDate, hasOutcome.has(a.id))).length,
    followup_overdue: followups.filter((row) => isFollowupPastDue(row, nowDate)).length,
    unconfirmed_24h: appts.filter((a) => isUnconfirmed24h(a, nowDate)).length,
    no_lawful_basis: people.filter((p) => !p.suppressed && p.lawful_basis == null).length,
  };

  const items = ATTENTION
    .filter((row) => counts[row.code] > 0)
    .map((row) => ({
      code: row.code,
      label: row.label,
      count: counts[row.code],
      href: row.href,
    }));
  return { items };
}

export async function registerDashboardRoutes(app) {
  app.get('/api/dashboard', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    return dashboardPayload(org, session, now(app.db));
  });

  app.get('/api/attention', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    return attentionPayload(org, session, now(app.db));
  });
}
