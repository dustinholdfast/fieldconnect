import { write as writeAudit } from '../audit.js';
import { loadBusyWindows } from './calendar.js';
import { endAt, now, nowIso, shiftIso, todayIso } from '../clock.js';
import { withOrg } from '../db.js';
import { assertRoutingAllowed } from '../training/gates.js';

const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const DEFAULT_RULES = {
  timezone: 'America/Chicago',
  duration_min: 45,
  min_notice_hours: 12,
  max_per_day: 4,
  weekday_mask: 126,
};

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

function overlaps(appt, slotStartMs, slotEndMs) {
  const a0 = Date.parse(appt.start_at);
  const a1 = endAt(appt).getTime();
  return a0 < slotEndMs && a1 > slotStartMs;
}

function loadPage(db, slug) {
  return db.prepare(`
    SELECT p.id, p.org_id, p.slug, p.kind, p.campaign_id,
           o.name AS org_name, o.timezone, o.slug AS org_slug,
           c.name AS campaign_name, c.code AS campaign_code
      FROM public_pages p
      JOIN organizations o ON o.id = p.org_id
      LEFT JOIN campaigns c ON c.id = p.campaign_id AND c.org_id = p.org_id
     WHERE p.slug = ?
     LIMIT 1
  `).get(slug);
}

function mapPage(row) {
  return {
    slug: row.slug,
    kind: row.kind,
    orgName: row.org_name,
    orgSlug: row.org_slug,
    campaign: row.campaign_name || 'Field event',
    campaignCode: row.campaign_code || null,
    timezone: row.timezone || 'America/Chicago',
    canRegister: row.kind === 'register' || row.kind === 'book',
    canBook: row.kind === 'book' || row.kind === 'register',
  };
}

function defaultFsm(db, orgId) {
  return db.prepare(`
    SELECT id FROM users WHERE org_id = ? AND role = 'fsm' AND active = 1 ORDER BY id ASC LIMIT 1
  `).get(orgId);
}

function loadRules(org) {
  return org.get(
    `SELECT timezone, duration_min, min_notice_hours, max_per_day, weekday_mask
       FROM availability_rules WHERE org_id = ? ORDER BY id ASC LIMIT 1`,
  ) || { ...DEFAULT_RULES };
}

function buildSlots(db, orgId, fsmUserId) {
  const org = withOrg(db, orgId);
  const rules = loadRules(org);
  const tz = rules.timezone || DEFAULT_RULES.timezone;
  const nowDate = now(db);
  const today = todayIso(db, tz);
  const mask = Number(rules.weekday_mask) || DEFAULT_RULES.weekday_mask;
  const durationMin = Number(rules.duration_min) || DEFAULT_RULES.duration_min;
  const minNoticeMs = (Number(rules.min_notice_hours) || DEFAULT_RULES.min_notice_hours) * 3600_000;
  const maxPerDay = Number(rules.max_per_day) || DEFAULT_RULES.max_per_day;
  const threshold = nowDate.getTime() + minNoticeMs;
  const dates = weekDates(today, mask);
  const appts = org.all(
    `SELECT id, start_at, duration_min, status FROM appointments
      WHERE org_id = ? AND status NOT IN ('Cancelled')`,
  );
  const busy = loadBusyWindows(db, orgId, fsmUserId);
  const perDay = new Map();
  for (const appt of appts) {
    const day = dateInTz(appt.start_at, tz);
    perDay.set(day, (perDay.get(day) || 0) + 1);
  }
  const days = dates.map((date) => {
    const dayFull = (perDay.get(date) || 0) >= maxPerDay;
    const slots = SLOT_HOURS.map((hour) => {
      const start = civilIso(date, hour, tz);
      const startMs = Date.parse(start);
      const end = shiftIso(start, durationMin * 60_000);
      const endMs = Date.parse(end);
      const hit = appts.find((appt) => overlaps(appt, startMs, endMs));
      if (hit) return { start, end, state: 'booked' };
      const calHit = busy.some((block) => block.start < endMs && block.end > startMs);
      if (startMs < threshold || dayFull || calHit) return { start, end, state: 'blocked' };
      return { start, end, state: 'free' };
    });
    return { date, slots };
  });
  return { days, timezone: tz, durationMin };
}

function parseIdentity(body) {
  const firstName = String(body?.firstName || '').trim();
  const lastName = String(body?.lastName || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  const phone = String(body?.phone || '').trim();
  const fields = {};
  if (!firstName) fields.firstName = 'Required';
  if (!lastName) fields.lastName = 'Required';
  if (!email && !phone) {
    fields.email = 'Email or phone is required';
    fields.phone = 'Email or phone is required';
  }
  if (email && !/^\S+@\S+\.\S+$/.test(email)) fields.email = 'Invalid email';
  return { fields, firstName, lastName, email: email || null, phone: phone || null };
}

function findOrCreatePerson(db, orgId, identity, at) {
  const org = withOrg(db, orgId);
  if (identity.email) {
    const existing = org.get(
      `SELECT * FROM people WHERE org_id = ? AND email = ? AND merged_into_id IS NULL`,
      [identity.email],
    );
    if (existing) return existing;
  }
  const displayName = `${identity.firstName} ${identity.lastName}`.trim();
  const info = org.run(
    `INSERT INTO people (
       org_id, first_name, last_name, display_name, email, phone,
       source, stage, lawful_basis, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'Other', 'Registered', 'consent', ?, ?)`,
    [identity.firstName, identity.lastName, displayName, identity.email, identity.phone, at, at],
  );
  return org.get(`SELECT * FROM people WHERE org_id = ? AND id = ?`, [Number(info.lastInsertRowid)]);
}

export async function registerPublicRoutes(app) {
  app.get('/api/public/:slug', async (request, reply) => {
    const row = loadPage(app.db, String(request.params.slug || ''));
    if (!row) return sendError(reply, 404, 'not_found');
    return mapPage(row);
  });

  app.get('/api/public/:slug/slots', async (request, reply) => {
    const row = loadPage(app.db, String(request.params.slug || ''));
    if (!row) return sendError(reply, 404, 'not_found');
    const fsm = defaultFsm(app.db, row.org_id);
    return buildSlots(app.db, row.org_id, fsm?.id ?? null);
  });

  app.post('/api/public/:slug/register', async (request, reply) => {
    const row = loadPage(app.db, String(request.params.slug || ''));
    if (!row) return sendError(reply, 404, 'not_found');
    const parsed = parseIdentity(request.body);
    if (Object.keys(parsed.fields).length) {
      return sendError(reply, 400, 'validation_failed', { fields: parsed.fields });
    }
    const at = nowIso(app.db);
    const person = findOrCreatePerson(app.db, row.org_id, parsed, at);
    writeAudit(app.db, {
      orgId: row.org_id,
      actorUserId: null,
      action: 'public.register',
      entityType: 'person',
      entityId: person.id,
      after: { slug: row.slug, source: 'public' },
    });
    return reply.code(201).send({
      person: { id: person.id, displayName: person.display_name, stage: person.stage },
    });
  });

  app.post('/api/public/:slug/book', async (request, reply) => {
    const row = loadPage(app.db, String(request.params.slug || ''));
    if (!row) return sendError(reply, 404, 'not_found');
    const parsed = parseIdentity(request.body);
    const startAt = typeof request.body?.startAt === 'string' ? request.body.startAt.trim() : '';
    if (!startAt || !Number.isFinite(Date.parse(startAt))) {
      parsed.fields.startAt = 'Start time is required';
    }
    if (Object.keys(parsed.fields).length) {
      return sendError(reply, 400, 'validation_failed', { fields: parsed.fields });
    }
    const fsm = defaultFsm(app.db, row.org_id);
    if (!fsm) return sendError(reply, 409, 'conflict', { message: 'No FSM is available to take this booking.' });
    const gated = assertRoutingAllowed(app.db, row.org_id, fsm.id);
    if (gated) return sendError(reply, 409, gated.code, { message: gated.message, gate: gated.gate });
    const at = nowIso(app.db);
    const person = findOrCreatePerson(app.db, row.org_id, parsed, at);
    const org = withOrg(app.db, row.org_id);
    const rules = loadRules(org);
    const tz = row.timezone || rules.timezone || 'America/Chicago';
    const durationMin = Number(rules.duration_min) || 45;
    const info = org.run(
      `INSERT INTO appointments (
         org_id, person_id, fsm_user_id, campaign_id, start_at, timezone,
         duration_min, status, offer_token, action_due, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Booked', NULL, NULL, ?)`,
      [person.id, fsm.id, row.campaign_id, startAt, tz, durationMin, at],
    );
    app.db.prepare(
      `UPDATE people SET stage = 'Scheduled', updated_at = ? WHERE org_id = ? AND id = ?`,
    ).run(at, row.org_id, person.id);
    const appointmentId = Number(info.lastInsertRowid);
    writeAudit(app.db, {
      orgId: row.org_id,
      actorUserId: null,
      action: 'public.book',
      entityType: 'appointment',
      entityId: appointmentId,
      after: { slug: row.slug, personId: person.id, startAt },
    });
    return reply.code(201).send({
      person: { id: person.id, displayName: person.display_name, stage: 'Scheduled' },
      appointment: { id: appointmentId, startAt, status: 'Booked' },
    });
  });
}
