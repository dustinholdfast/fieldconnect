import { write as writeAudit } from '../audit.js';
import { endAt, now, nowIso, shiftIso, todayIso } from '../clock.js';
import { withOrg } from '../db.js';

const NEEDS_STATUSES = new Set(['Booked', 'Confirmed', 'Reminder due', 'Partial']);
const NON_CANCELLED = (status) => status !== 'Cancelled';
const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const FROM_BOOKED = new Set([
  'Confirmed', 'Reminder due', 'Partial', 'Completed', 'No-show', 'Cancelled',
]);
const TRANSITIONS = {
  Offered: new Set(['Booked', 'Cancelled']),
  Booked: FROM_BOOKED,
  Confirmed: FROM_BOOKED,
  'Reminder due': FROM_BOOKED,
  Partial: new Set(['Completed', 'No-show', 'Cancelled']),
};

const DEFAULT_RULES = {
  timezone: 'America/Chicago',
  work_start: '09:00',
  work_end: '19:00',
  duration_min: 45,
  buffer_min: 15,
  min_notice_hours: 12,
  max_per_day: 4,
  weekday_mask: 126,
};

function stripOrg(body) {
  if (!body || typeof body !== 'object') return {};
  const { org_id: _orgIdSnake, orgId: _orgIdCamel, ...rest } = body;
  return rest;
}

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function partsInTz(instant, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

function dateInTz(iso, tz) {
  const parts = partsInTz(new Date(Date.parse(iso)), tz);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function offsetOf(instant, tz) {
  const p = partsInTz(instant, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offMin = Math.round((asUtc - instant.getTime()) / 60_000);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function civilIso(dateStr, hour, tz) {
  let guess = Date.parse(`${dateStr}T${pad2(hour)}:00:00Z`);
  for (let i = 0; i < 3; i += 1) {
    const off = offsetOf(new Date(guess), tz);
    guess = Date.parse(`${dateStr}T${pad2(hour)}:00:00${off}`);
  }
  return `${dateStr}T${pad2(hour)}:00:00${offsetOf(new Date(guess), tz)}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekDates(today, mask) {
  const sunday = addDays(today, -weekdayOf(today));
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(sunday, i);
    if ((mask & (1 << weekdayOf(date))) !== 0) dates.push(date);
  }
  return dates;
}

function calendarWeekDates(today) {
  const sunday = addDays(today, -weekdayOf(today));
  const dates = [];
  for (let i = 0; i < 7; i += 1) dates.push(addDays(sunday, i));
  return dates;
}

function loadRules(org) {
  const row = org.get(
    `SELECT timezone, work_start, work_end, duration_min, buffer_min,
            min_notice_hours, max_per_day, weekday_mask
       FROM availability_rules
      WHERE org_id = ?
      ORDER BY id ASC LIMIT 1`,
  );
  return row || { ...DEFAULT_RULES };
}

function isAssigned(org, userId, personId) {
  return !!org.get(
    `SELECT id FROM assignments WHERE org_id = ? AND person_id = ? AND user_id = ?`,
    [personId, userId],
  );
}

function loadAppointment(org, id) {
  return org.get(
    `SELECT a.*,
            p.display_name AS person_name,
            u.display_name AS fsm_name,
            c.name AS event_name
       FROM appointments a
       JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
       LEFT JOIN users u ON u.id = a.fsm_user_id AND u.org_id = a.org_id
       LEFT JOIN campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
      WHERE a.org_id = ? AND a.id = ?`,
    [id],
  );
}

function scopedAppointment(org, session, id) {
  const row = loadAppointment(org, id);
  if (!row) return null;
  if (session.role === 'fsm' && row.fsm_user_id !== session.userId) return null;
  return row;
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

function computeNeedsOutcome(db, appt, tz, nowDate, today, hasOutcome) {
  if (hasOutcome) return false;
  if (!NEEDS_STATUSES.has(appt.status)) return false;
  const startDate = dateInTz(appt.start_at, tz);
  const ended = endAt(appt).getTime() <= nowDate.getTime();
  return startDate === today || ended;
}

function toAppointmentDto(row, extras = {}) {
  return {
    id: row.id,
    personId: row.person_id,
    personName: extras.personName || row.person_name || '—',
    event: extras.event || row.event_name || '—',
    fsmUserId: row.fsm_user_id,
    fsmName: extras.fsmName || row.fsm_name || '—',
    startAt: row.start_at,
    endAt: shiftIso(row.start_at, Number(row.duration_min) * 60_000),
    timezone: row.timezone,
    durationMin: row.duration_min,
    status: row.status,
    actionDue: row.action_due,
    offerToken: row.offer_token,
    actualDurationMin: row.actual_duration_min ?? null,
    partialReason: row.partial_reason ?? null,
    needsOutcome: extras.needsOutcome === true,
  };
}

function hydrateOne(db, org, row, tz, nowDate, today) {
  const has = outcomeIds(org, [row.id]).has(row.id);
  return toAppointmentDto(row, {
    needsOutcome: computeNeedsOutcome(db, row, tz, nowDate, today, has),
  });
}

function fsmClause(session, query) {
  const clauses = [];
  const params = [];
  if (session.role === 'fsm') {
    clauses.push('a.fsm_user_id = ?');
    params.push(session.userId);
  } else {
    const fsm = typeof query?.fsm === 'string' ? query.fsm.trim() : '';
    if (/^\d+$/.test(fsm)) {
      clauses.push('a.fsm_user_id = ?');
      params.push(Number(fsm));
    }
  }
  return { clauses, params };
}

function listAppointments(org, session, query) {
  const { clauses, params } = fsmClause(session, query);
  const where = ['a.org_id = a.org_id', ...clauses].join(' AND ');
  return org.all(
    `SELECT a.*,
            p.display_name AS person_name,
            u.display_name AS fsm_name,
            c.name AS event_name
       FROM appointments a
       JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
       LEFT JOIN users u ON u.id = a.fsm_user_id AND u.org_id = a.org_id
       LEFT JOIN campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
      WHERE a.org_id = ? AND ${where}
      ORDER BY a.start_at ASC, a.id ASC`,
    params,
  );
}

function applyListFilters(rows, query, tz) {
  const from = typeof query?.from === 'string' ? query.from.trim() : '';
  const to = typeof query?.to === 'string' ? query.to.trim() : '';
  let next = rows;
  if (from) {
    next = next.filter((row) => dateInTz(row.start_at, tz) >= from.slice(0, 10));
  }
  if (to) {
    next = next.filter((row) => dateInTz(row.start_at, tz) <= to.slice(0, 10));
  }
  return next;
}

function actionDueFor(status, previous) {
  if (status === 'Booked' || status === 'Confirmed') return null;
  if (status === 'Cancelled') return 'Cancelled';
  if (status === 'Reminder due') return 'Send 24 h reminder';
  if (status === 'Partial') return 'Finish outcome form';
  return previous;
}

function resolveFsmUser(org, fsmUserId) {
  if (fsmUserId == null) return null;
  return org.get(
    `SELECT id, active FROM users WHERE org_id = ? AND id = ? AND role = 'fsm'`,
    [fsmUserId],
  );
}

function overlaps(appt, slotStartMs, slotEndMs) {
  const a0 = Date.parse(appt.start_at);
  const a1 = endAt(appt).getTime();
  return a0 < slotEndMs && a1 > slotStartMs;
}

export async function registerSchedulingRoutes(app) {
  app.get('/api/appointments', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const tz = session.orgTimezone || 'America/Chicago';
    const nowDate = now(app.db);
    const today = todayIso(app.db, tz);
    const rows = applyListFilters(listAppointments(org, session, request.query || {}), request.query || {}, tz);
    const hasOutcome = outcomeIds(org, rows.map((r) => r.id));
    const filter = typeof request.query?.filter === 'string' ? request.query.filter : '';
    let items = rows.map((row) => toAppointmentDto(row, {
      needsOutcome: computeNeedsOutcome(app.db, row, tz, nowDate, today, hasOutcome.has(row.id)),
    }));
    if (filter === 'needs_outcome') {
      items = items.filter((item) => item.needsOutcome);
    } else if (filter === 'outcome_overdue') {
      const cutoff = nowDate.getTime() - 48 * 60 * 60 * 1000;
      const overdue = new Set(['Confirmed', 'Booked', 'Reminder due', 'Partial']);
      items = items.filter((item) => (
        overdue.has(item.status)
        && !hasOutcome.has(item.id)
        && Date.parse(item.endAt) < cutoff
      ));
    } else if (filter === 'unconfirmed') {
      const horizon = nowDate.getTime() + 24 * 60 * 60 * 1000;
      items = items.filter((item) => {
        const start = Date.parse(item.startAt);
        return item.status === 'Booked' && start >= nowDate.getTime() && start <= horizon;
      });
    }
    return { items };
  });

  app.get('/api/appointments/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const row = scopedAppointment(org, session, Number(request.params.id));
    if (!row) return sendError(reply, 404, 'not_found');
    const tz = session.orgTimezone || row.timezone || 'America/Chicago';
    return hydrateOne(app.db, org, row, tz, now(app.db), todayIso(app.db, tz));
  });

  app.post('/api/appointments', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const body = stripOrg(request.body);
    const fields = {};
    const personId = Number(body.personId);
    if (!Number.isInteger(personId) || personId < 1) fields.personId = 'Person is required';
    const startAt = typeof body.startAt === 'string' ? body.startAt.trim() : '';
    if (!startAt || !Number.isFinite(Date.parse(startAt))) fields.startAt = 'Start time is required';
    let fsmUserId = body.fsmUserId === undefined || body.fsmUserId === '' || body.fsmUserId === null
      ? null
      : Number(body.fsmUserId);
    if (session.role === 'fsm') {
      fsmUserId = session.userId;
    } else if (!Number.isInteger(fsmUserId) || fsmUserId < 1) {
      fields.fsmUserId = 'FSM is required';
    }
    let durationMin = body.durationMin === undefined || body.durationMin === null || body.durationMin === ''
      ? 45
      : Number(body.durationMin);
    if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 180) {
      fields.durationMin = 'Duration must be 1–180 minutes';
    }
    if (Object.keys(fields).length) {
      return sendError(reply, 400, 'validation_failed', { fields });
    }
    const person = org.get(
      `SELECT * FROM people WHERE org_id = ? AND id = ? AND merged_into_id IS NULL`,
      [personId],
    );
    if (!person) return sendError(reply, 404, 'not_found');
    if (session.role === 'fsm' && !isAssigned(org, session.userId, personId)) {
      return sendError(reply, 404, 'not_found');
    }
    const fsm = resolveFsmUser(org, fsmUserId);
    if (!fsm || !fsm.active) {
      return sendError(reply, 400, 'validation_failed', { fields: { fsmUserId: 'Unknown FSM' } });
    }
    let campaignId = body.campaignId == null || body.campaignId === '' ? null : Number(body.campaignId);
    if (campaignId != null && !Number.isInteger(campaignId)) campaignId = null;
    const rules = loadRules(org);
    const tz = session.orgTimezone || rules.timezone || 'America/Chicago';
    const at = nowIso(app.db);
    const info = org.run(
      `INSERT INTO appointments (
         org_id, person_id, fsm_user_id, campaign_id, start_at, timezone,
         duration_min, status, offer_token, action_due, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Booked', NULL, NULL, ?)`,
      [personId, fsmUserId, campaignId, startAt, tz, durationMin, at],
    );
    const id = Number(info.lastInsertRowid);
    app.db.prepare(
      `UPDATE people SET stage = 'Scheduled', updated_at = ? WHERE org_id = ? AND id = ?`,
    ).run(at, session.orgId, personId);
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'appointment.create',
      entityType: 'appointment',
      entityId: id,
      after: { personId, startAt, status: 'Booked' },
    });
    const row = loadAppointment(org, id);
    return reply.code(201).send({
      appointment: hydrateOne(app.db, org, row, tz, now(app.db), todayIso(app.db, tz)),
    });
  });

  app.patch('/api/appointments/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const row = scopedAppointment(org, session, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const body = stripOrg(request.body);
    const hasStatus = typeof body.status === 'string' && body.status !== '';
    const hasFsm = Object.prototype.hasOwnProperty.call(body, 'fsmUserId');
    if (!hasStatus && !hasFsm) {
      return sendError(reply, 400, 'validation_failed', { fields: { status: 'Nothing to update' } });
    }

    let nextStatus = row.status;
    if (hasStatus) {
      const allowed = TRANSITIONS[row.status];
      if (!allowed || !allowed.has(body.status)) return sendError(reply, 409, 'conflict');
      nextStatus = body.status;
    }

    let nextFsm = row.fsm_user_id;
    if (hasFsm) {
      if (session.role === 'fsm') {
        return sendError(reply, 403, 'forbidden');
      }
      const fsmUserId = body.fsmUserId == null || body.fsmUserId === '' ? null : Number(body.fsmUserId);
      if (fsmUserId != null) {
        const fsm = resolveFsmUser(org, fsmUserId);
        if (!fsm || !fsm.active) {
          return sendError(reply, 400, 'validation_failed', { fields: { fsmUserId: 'Unknown FSM' } });
        }
        nextFsm = fsm.id;
      } else {
        nextFsm = null;
      }
    }

    const actionDue = hasStatus ? actionDueFor(nextStatus, row.action_due) : row.action_due;
    app.db.prepare(
      `UPDATE appointments SET status = ?, fsm_user_id = ?, action_due = ?
        WHERE org_id = ? AND id = ?`,
    ).run(nextStatus, nextFsm, actionDue, session.orgId, id);
    if (nextStatus === 'Booked') {
      app.db.prepare(
        `UPDATE people SET stage = 'Scheduled', updated_at = ? WHERE org_id = ? AND id = ?`,
      ).run(nowIso(app.db), session.orgId, row.person_id);
    }
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'appointment.update',
      entityType: 'appointment',
      entityId: id,
      before: { status: row.status, fsmUserId: row.fsm_user_id },
      after: { status: nextStatus, fsmUserId: nextFsm },
    });
    const next = loadAppointment(org, id);
    const tz = session.orgTimezone || next.timezone || 'America/Chicago';
    return { appointment: hydrateOne(app.db, org, next, tz, now(app.db), todayIso(app.db, tz)) };
  });

  app.get('/api/scheduling/summary', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const tz = session.orgTimezone || 'America/Chicago';
    const nowDate = now(app.db);
    const today = todayIso(app.db, tz);
    const week = new Set(calendarWeekDates(today));
    const cutoff = nowDate.getTime() - 30 * 24 * 60 * 60 * 1000;
    const rows = listAppointments(org, session, {});
    const hasOutcome = outcomeIds(org, rows.map((r) => r.id));
    let bookedThisWeek = 0;
    let confirmed = 0;
    let awaitingOutcome = 0;
    let noShows = 0;
    let completed = 0;
    for (const row of rows) {
      const startDate = dateInTz(row.start_at, tz);
      if (week.has(startDate) && NON_CANCELLED(row.status) && row.status !== 'Offered') {
        bookedThisWeek += 1;
      }
      if (row.status === 'Confirmed') confirmed += 1;
      if (computeNeedsOutcome(app.db, row, tz, nowDate, today, hasOutcome.has(row.id))) {
        awaitingOutcome += 1;
      }
      const startMs = Date.parse(row.start_at);
      if (startMs >= cutoff) {
        if (row.status === 'No-show') noShows += 1;
        if (row.status === 'Completed') completed += 1;
      }
    }
    const denom = noShows + completed;
    return {
      bookedThisWeek,
      confirmed,
      awaitingOutcome,
      noShowRate30d: denom === 0 ? 0 : noShows / denom,
    };
  });

  app.get('/api/scheduling/slots', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const rules = loadRules(org);
    const tz = rules.timezone || session.orgTimezone || 'America/Chicago';
    const nowDate = now(app.db);
    const today = todayIso(app.db, tz);
    const mask = Number(rules.weekday_mask) || DEFAULT_RULES.weekday_mask;
    const durationMin = Number(rules.duration_min) || DEFAULT_RULES.duration_min;
    const minNoticeMs = (Number(rules.min_notice_hours) || DEFAULT_RULES.min_notice_hours) * 60 * 60 * 1000;
    const maxPerDay = Number(rules.max_per_day) || DEFAULT_RULES.max_per_day;
    const threshold = nowDate.getTime() + minNoticeMs;

    let dates;
    const from = typeof request.query?.from === 'string' ? request.query.from.trim() : '';
    const to = typeof request.query?.to === 'string' ? request.query.to.trim() : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      dates = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if ((mask & (1 << weekdayOf(d))) !== 0) dates.push(d);
      }
    } else {
      dates = weekDates(today, mask);
    }

    const appts = listAppointments(org, session, request.query || {}).filter((row) => NON_CANCELLED(row.status));
    const perDay = new Map();
    for (const appt of appts) {
      const day = dateInTz(appt.start_at, tz);
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }

    const days = dates.map((date) => {
      const dayCount = perDay.get(date) || 0;
      const dayFull = dayCount >= maxPerDay;
      const slots = SLOT_HOURS.map((hour) => {
        const start = civilIso(date, hour, tz);
        const startMs = Date.parse(start);
        const end = shiftIso(start, durationMin * 60_000);
        const endMs = Date.parse(end);
        const hit = appts.find((appt) => overlaps(appt, startMs, endMs));
        if (hit) {
          return { start, end, state: 'booked', appointmentId: hit.id };
        }
        if (startMs < threshold || dayFull) {
          return { start, end, state: 'blocked' };
        }
        return { start, end, state: 'free' };
      });
      return { date, slots };
    });

    return { days, timezone: tz, durationMin };
  });
}
