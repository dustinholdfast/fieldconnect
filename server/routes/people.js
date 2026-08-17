import { randomBytes } from 'node:crypto';
import { write as writeAudit } from '../audit.js';
import { nowIso, shiftIso } from '../clock.js';
import { withOrg } from '../db.js';

const STAGES = new Set([
  'Registered', 'Attended', 'Scheduled', 'Completed', 'No-show', 'Interested', 'Not a fit',
]);
const SOURCES = new Set(['Meetup', 'Div 6 list', 'Referral', 'Social (SCN group)', 'Other']);
const RUINS = new Set([
  'Relationships / family',
  'Work & livelihood',
  'Health & well-being',
  'Grief or loss',
  'Stress & anxiety',
  'Study / learning',
  'Purpose & direction',
]);
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const CHANNEL_LABELS = {
  email: 'Email',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  followup: 'Follow-up',
  testimonial: 'Testimonial',
  public_story: 'Public story',
};
const PHONE_DIGITS_SQL = `replace(replace(replace(replace(replace(replace(replace(coalesce(p.phone,''),'+',''),'-',''),' ',''),'(',''),')',''),'.',''),char(160),'')`;

function stripOrg(body) {
  if (!body || typeof body !== 'object') return {};
  const { org_id: _orgIdSnake, orgId: _orgIdCamel, ...rest } = body;
  return rest;
}

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function clampLimit(raw) {
  const n = Number.parseInt(raw ?? '50', 10);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(n, 200);
}

function clampOffset(raw) {
  const n = Number.parseInt(raw ?? '0', 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function isAssigned(org, userId, personId) {
  return !!org.get(
    `SELECT id FROM assignments WHERE org_id = ? AND person_id = ? AND user_id = ?`,
    [personId, userId],
  );
}

function loadPersonRow(org, id) {
  return org.get(
    `SELECT p.* FROM people p WHERE p.org_id = ? AND p.id = ? AND p.merged_into_id IS NULL`,
    [id],
  );
}

function scopedPerson(org, session, id) {
  const row = loadPersonRow(org, id);
  if (!row) return null;
  if (session.role === 'fsm' && !isAssigned(org, session.userId, id)) return null;
  return row;
}

function loadConsents(org, personIds) {
  const map = new Map();
  if (!personIds.length) return map;
  const placeholders = personIds.map(() => '?').join(', ');
  const rows = org.all(
    `SELECT person_id, channel, granted, granted_at, withdrawn_at
       FROM consent_records
      WHERE org_id = ? AND person_id IN (${placeholders})`,
    personIds,
  );
  for (const row of rows) {
    const list = map.get(row.person_id) || [];
    list.push(row);
    map.set(row.person_id, list);
  }
  return map;
}

function consentLabel(rows, suppressed) {
  if (suppressed) return 'Opted out';
  const granted = (rows || []).filter((r) => r.granted);
  if (!granted.length) return '—';
  return granted.map((r) => CHANNEL_LABELS[r.channel] || r.channel).join(', ');
}

function personExtras(org, personId) {
  const fsm = org.get(
    `SELECT a.user_id AS fsmUserId, u.display_name AS fsmName
       FROM assignments a
       JOIN users u ON u.id = a.user_id AND u.org_id = a.org_id
      WHERE a.org_id = ? AND a.person_id = ? AND a.kind = 'fsm'
      ORDER BY a.id DESC LIMIT 1`,
    [personId],
  );
  const event = org.get(
    `SELECT e.campaign_id AS eventId, c.name AS eventName
       FROM engagements e
       JOIN campaigns c ON c.id = e.campaign_id AND c.org_id = e.org_id
      WHERE e.org_id = ? AND e.person_id = ? AND e.campaign_id IS NOT NULL
      ORDER BY e.occurred_at DESC LIMIT 1`,
    [personId],
  );
  const journey = org.get(
    `SELECT j.name AS journeyName, p.journey_key AS journeyKey
       FROM people p
       LEFT JOIN journeys j ON j.key = p.journey_key
      WHERE p.org_id = ? AND p.id = ?`,
    [personId],
  );
  return {
    fsmUserId: fsm?.fsmUserId ?? null,
    fsmName: fsm?.fsmName ?? null,
    eventId: event?.eventId ?? null,
    eventName: event?.eventName ?? null,
    journeyName: journey?.journeyName ?? null,
    journeyKey: journey?.journeyKey ?? null,
  };
}

function toPersonDto(row, extras, consents) {
  const suppressed = !!row.suppressed;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    postalCode: row.postal_code,
    source: row.source,
    stage: row.stage,
    consent: consentLabel(consents, suppressed),
    consents: (consents || []).map((c) => ({
      channel: c.channel,
      granted: !!c.granted,
    })),
    fsm: extras.fsmName || '—',
    fsmUserId: extras.fsmUserId,
    event: extras.eventName || '—',
    eventId: extras.eventId,
    ruin: row.ruin_category || '—',
    ruinCategory: row.ruin_category,
    journey: extras.journeyName || '—',
    journeyKey: extras.journeyKey || row.journey_key,
    lawfulBasis: row.lawful_basis,
    suppressed,
  };
}

function hydratePerson(org, row) {
  const extras = personExtras(org, row.id);
  const consents = loadConsents(org, [row.id]).get(row.id) || [];
  return toPersonDto(row, extras, consents);
}

function listFsms(org) {
  return org.all(
    `SELECT id, display_name AS displayName
       FROM users
      WHERE org_id = ? AND role = 'fsm' AND active = 1
      ORDER BY display_name`,
  );
}

function buildListQuery(session, query) {
  const clauses = ['p.org_id = ?', 'p.merged_into_id IS NULL'];
  const params = [];

  if (session.role === 'fsm') {
    clauses.push(`EXISTS (
      SELECT 1 FROM assignments a
       WHERE a.org_id = p.org_id AND a.person_id = p.id AND a.user_id = ?
    )`);
    params.push(session.userId);
  }

  const stage = typeof query.stage === 'string' ? query.stage.trim() : '';
  if (stage && stage !== 'All') {
    clauses.push('p.stage = ?');
    params.push(stage);
  }

  const event = typeof query.event === 'string' ? query.event.trim() : '';
  if (event) {
    clauses.push(`(
      SELECT c.name FROM engagements e
        JOIN campaigns c ON c.id = e.campaign_id AND c.org_id = e.org_id
       WHERE e.org_id = p.org_id AND e.person_id = p.id AND e.campaign_id IS NOT NULL
       ORDER BY e.occurred_at DESC LIMIT 1
    ) LIKE ?`);
    params.push(`%${event}%`);
  }

  const fsm = typeof query.fsm === 'string' ? query.fsm.trim() : '';
  if (fsm) {
    if (/^\d+$/.test(fsm)) {
      clauses.push(`EXISTS (
        SELECT 1 FROM assignments a
         WHERE a.org_id = p.org_id AND a.person_id = p.id AND a.user_id = ?
      )`);
      params.push(Number(fsm));
    } else {
      clauses.push(`EXISTS (
        SELECT 1 FROM assignments a
          JOIN users u ON u.id = a.user_id AND u.org_id = a.org_id
         WHERE a.org_id = p.org_id AND a.person_id = p.id AND lower(u.display_name) LIKE ?
      )`);
      params.push(`%${fsm.toLowerCase()}%`);
    }
  }

  const ruin = typeof query.ruin === 'string' ? query.ruin.trim() : '';
  if (ruin) {
    clauses.push('lower(coalesce(p.ruin_category, \'\')) LIKE ?');
    params.push(`%${ruin.toLowerCase()}%`);
  }

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const qDigits = digitsOnly(q);
    const phoneClause = qDigits
      ? ` OR ${PHONE_DIGITS_SQL} LIKE ?`
      : '';
    clauses.push(`(
      lower(p.display_name) LIKE ?
      OR lower(coalesce(p.email, '')) LIKE ?
      OR lower(coalesce(p.ruin_category, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM assignments a
          JOIN users u ON u.id = a.user_id AND u.org_id = a.org_id
         WHERE a.org_id = p.org_id AND a.person_id = p.id AND lower(u.display_name) LIKE ?
      )
      OR EXISTS (
        SELECT 1 FROM engagements e
          JOIN campaigns c ON c.id = e.campaign_id AND c.org_id = e.org_id
         WHERE e.org_id = p.org_id AND e.person_id = p.id AND lower(c.name) LIKE ?
      )
      ${phoneClause}
    )`);
    params.push(like, like, like, like, like);
    if (qDigits) params.push(`%${qDigits}%`);
  }

  return { where: clauses.join(' AND '), params };
}

function validatePerson(body, { create }) {
  const fields = {};
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  if (create || body.firstName !== undefined) {
    if (!firstName) fields.firstName = 'First name is required';
  }
  if (create || body.lastName !== undefined) {
    if (!lastName) fields.lastName = 'Last name is required';
  }

  let email = body.email === undefined ? undefined : (typeof body.email === 'string' ? body.email.trim() : '');
  if (email === '') email = null;
  if (email != null && email !== undefined && !EMAIL_RE.test(email)) {
    fields.email = 'Enter a valid email';
  }

  let phone = body.phone === undefined ? undefined : (typeof body.phone === 'string' ? body.phone.trim() : '');
  if (phone === '') phone = null;
  if (phone != null && phone !== undefined && digitsOnly(phone).length < 10) {
    fields.phone = 'Phone must have at least 10 digits';
  }

  const source = body.source === undefined ? undefined : (typeof body.source === 'string' ? body.source.trim() : '');
  if (create) {
    if (!source) fields.source = 'Source is required';
    else if (!SOURCES.has(source)) fields.source = 'Unknown source';
  } else if (source !== undefined) {
    if (!source || !SOURCES.has(source)) fields.source = 'Unknown source';
  }

  const stage = body.stage === undefined ? undefined : (typeof body.stage === 'string' ? body.stage.trim() : '');
  if (stage !== undefined && stage !== '' && !STAGES.has(stage)) {
    fields.stage = 'Unknown stage';
  }

  let ruinCategory = body.ruinCategory;
  if (ruinCategory !== undefined) {
    ruinCategory = typeof ruinCategory === 'string' ? ruinCategory.trim() : '';
    if (ruinCategory === '') ruinCategory = null;
    else if (!RUINS.has(ruinCategory)) fields.ruinCategory = 'Unknown ruin category';
  }

  if (create) {
    const hasEmail = !!(email);
    const hasPhone = !!(phone);
    if (!hasEmail && !hasPhone) {
      fields.email = fields.email || 'Email or phone is required';
      fields.phone = fields.phone || 'Email or phone is required';
    }
  } else if (body.email !== undefined || body.phone !== undefined) {
    const nextEmail = email === undefined ? undefined : email;
    const nextPhone = phone === undefined ? undefined : phone;
    if (nextEmail === null && nextPhone === null) {
      fields.email = fields.email || 'Email or phone is required';
      fields.phone = fields.phone || 'Email or phone is required';
    }
  }

  let postalCode = body.postalCode;
  if (postalCode !== undefined) {
    postalCode = typeof postalCode === 'string' ? postalCode.trim() : '';
    if (postalCode === '') postalCode = null;
  }

  let fsmUserId = body.fsmUserId;
  if (fsmUserId !== undefined) {
    if (fsmUserId === null || fsmUserId === '' || fsmUserId === '—') fsmUserId = null;
    else {
      const n = Number(fsmUserId);
      if (!Number.isInteger(n) || n < 1) fields.fsmUserId = 'Unknown FSM';
      else fsmUserId = n;
    }
  }

  return {
    fields,
    value: {
      firstName,
      lastName,
      email,
      phone,
      source,
      stage,
      ruinCategory,
      postalCode,
      fsmUserId,
    },
  };
}

function uniqueConflict(err) {
  return err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(err.message)));
}

function resolveFsmUser(org, fsmUserId, { allowInactiveId } = {}) {
  if (fsmUserId == null) return null;
  const row = org.get(
    `SELECT id, active FROM users WHERE org_id = ? AND id = ? AND role = 'fsm'`,
    [fsmUserId],
  );
  if (!row) return null;
  if (row.active) return row;
  if (allowInactiveId != null && row.id === allowInactiveId) return row;
  return null;
}

function setFsmAssignment(db, orgId, personId, fsmUserId, at) {
  db.prepare(`DELETE FROM assignments WHERE org_id = ? AND person_id = ? AND kind = 'fsm'`)
    .run(orgId, personId);
  if (fsmUserId) {
    db.prepare(`
      INSERT INTO assignments (org_id, person_id, user_id, kind, status, created_at)
      VALUES (?, ?, ?, 'fsm', 'open', ?)
    `).run(orgId, personId, fsmUserId, at);
  }
}

function appointmentDto(org, row) {
  const person = org.get(
    `SELECT display_name FROM people WHERE org_id = ? AND id = ?`,
    [row.person_id],
  );
  const fsm = row.fsm_user_id
    ? org.get(`SELECT display_name FROM users WHERE org_id = ? AND id = ?`, [row.fsm_user_id])
    : null;
  const campaign = row.campaign_id
    ? org.get(`SELECT name FROM campaigns WHERE org_id = ? AND id = ?`, [row.campaign_id])
    : null;
  return {
    id: row.id,
    personId: row.person_id,
    personName: person?.display_name || '—',
    event: campaign?.name || '—',
    fsmUserId: row.fsm_user_id,
    fsmName: fsm?.display_name || '—',
    startAt: row.start_at,
    timezone: row.timezone,
    durationMin: row.duration_min,
    status: row.status,
    actionDue: row.action_due,
    offerToken: row.offer_token,
    createdAt: row.created_at,
  };
}

function expiresAt(createdAt) {
  return shiftIso(createdAt, 2 * 24 * 60 * 60 * 1000);
}

function offerPayload(org, session, row) {
  const appointment = appointmentDto(org, row);
  return {
    appointment: {
      ...appointment,
      expiresAt: expiresAt(row.created_at),
    },
    offerUrl: `/scheduling?offer=${row.offer_token}`,
    person: appointment.personName,
    event: appointment.event,
    fsm: appointment.fsmName,
    status: appointment.status,
    expires: expiresAt(row.created_at),
  };
}

function loadAppointmentByToken(org, session, token) {
  if (!token) return null;
  const row = org.get(
    `SELECT * FROM appointments WHERE org_id = ? AND offer_token = ?`,
    [token],
  );
  if (!row) return null;
  if (session.role === 'fsm' && row.fsm_user_id !== session.userId) return null;
  return row;
}

function mergeConsent(db, orgId, winnerId, loserId) {
  const rows = db.prepare(
    `SELECT * FROM consent_records WHERE org_id = ? AND person_id IN (?, ?)`,
  ).all(orgId, winnerId, loserId);
  const byChannel = new Map();
  for (const row of rows) {
    const list = byChannel.get(row.channel) || [];
    list.push(row);
    byChannel.set(row.channel, list);
  }
  for (const channelRows of byChannel.values()) {
    const grantedRows = channelRows.filter((r) => r.granted);
    const keepGranted = grantedRows.length > 0;
    const pool = keepGranted ? grantedRows : channelRows;
    const grantedAt = pool
      .map((r) => r.granted_at)
      .filter(Boolean)
      .sort()[0] || null;
    pool.sort((a, b) => a.id - b.id);
    const keep = pool[0];
    db.prepare(`
      UPDATE consent_records
         SET person_id = ?, granted = ?, granted_at = ?, withdrawn_at = ?
       WHERE org_id = ? AND id = ?
    `).run(winnerId, keepGranted ? 1 : 0, grantedAt, keepGranted ? null : keep.withdrawn_at, orgId, keep.id);
    for (const row of channelRows) {
      if (row.id !== keep.id) {
        db.prepare(`DELETE FROM consent_records WHERE org_id = ? AND id = ?`).run(orgId, row.id);
      }
    }
  }
}

function mergePeople(db, orgId, winnerId, loserId, at) {
  mergeConsent(db, orgId, winnerId, loserId);
  db.prepare(`UPDATE engagements SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE appointments SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE assignments SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  const dups = db.prepare(`
    SELECT user_id, kind, MIN(id) AS keep_id
      FROM assignments
     WHERE org_id = ? AND person_id = ?
     GROUP BY user_id, kind
    HAVING COUNT(*) > 1
  `).all(orgId, winnerId);
  for (const dup of dups) {
    db.prepare(`
      DELETE FROM assignments
       WHERE org_id = ? AND person_id = ? AND user_id = ? AND kind = ? AND id != ?
    `).run(orgId, winnerId, dup.user_id, dup.kind, dup.keep_id);
  }
  db.prepare(`
    UPDATE import_rows SET match_person_id = ?
     WHERE match_person_id = ?
       AND import_id IN (SELECT id FROM imports WHERE org_id = ?)
  `).run(winnerId, loserId, orgId);
  db.prepare(`UPDATE outcomes SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE stories SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE people SET merged_into_id = ?, updated_at = ? WHERE org_id = ? AND id = ?`)
    .run(winnerId, at, orgId, loserId);
}

export async function registerPeopleRoutes(app) {
  app.get('/api/people', async (request) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const { where, params } = buildListQuery(session, request.query || {});
    const limit = clampLimit(request.query?.limit);
    const offset = clampOffset(request.query?.offset);
    const total = org.get(
      `SELECT COUNT(*) AS c FROM people p WHERE ${where} AND p.org_id = p.org_id`,
      params,
    ).c;
    const rows = org.all(
      `SELECT p.* FROM people p WHERE ${where} AND p.org_id = p.org_id ORDER BY p.display_name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const consents = loadConsents(org, rows.map((r) => r.id));
    const items = rows.map((row) => {
      const extras = personExtras(org, row.id);
      return toPersonDto(row, extras, consents.get(row.id) || []);
    });
    return { total, items, fsms: listFsms(org) };
  });

  app.post('/api/people', async (request, reply) => {
    const session = request.fcSession;
    const body = stripOrg(request.body);
    const { fields, value } = validatePerson(body, { create: true });
    if (Object.keys(fields).length) {
      return sendError(reply, 400, 'validation_failed', { fields });
    }
    const org = withOrg(app.db, session.orgId);
    if (value.fsmUserId != null && !resolveFsmUser(org, value.fsmUserId)) {
      return sendError(reply, 400, 'validation_failed', { fields: { fsmUserId: 'Unknown FSM' } });
    }
    const at = nowIso(app.db);
    const displayName = `${value.firstName} ${value.lastName}`;
    const stage = value.stage && STAGES.has(value.stage) ? value.stage : 'Registered';
    let id;
    try {
      const info = org.run(
        `INSERT INTO people (
           org_id, first_name, last_name, display_name, email, phone, postal_code,
           source, stage, ruin_category, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          value.firstName,
          value.lastName,
          displayName,
          value.email ?? null,
          value.phone ?? null,
          value.postalCode ?? null,
          value.source,
          stage,
          value.ruinCategory ?? null,
          at,
          at,
        ],
      );
      id = Number(info.lastInsertRowid);
    } catch (err) {
      if (uniqueConflict(err)) {
        return sendError(reply, 409, 'conflict', { message: 'Email already exists' });
      }
      throw err;
    }
    if (value.fsmUserId) setFsmAssignment(app.db, session.orgId, id, value.fsmUserId, at);
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'person.create',
      entityType: 'person',
      entityId: id,
      after: { id, displayName },
    });
    return reply.code(201).send(hydratePerson(org, loadPersonRow(org, id)));
  });

  app.get('/api/people/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const row = scopedPerson(org, session, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const item = hydratePerson(org, row);
    const engagements = org.all(
      `SELECT occurred_at, type, payload_json
         FROM engagements
        WHERE org_id = ? AND person_id = ?
        ORDER BY occurred_at ASC, id ASC`,
      [id],
    );
    item.history = engagements.map((e) => {
      let text = e.type === 'link_sent' ? 'Scheduling link sent' : e.type;
      if (e.payload_json) {
        try {
          const payload = JSON.parse(e.payload_json);
          if (payload && payload.text) text = payload.text;
        } catch { /* keep type label */ }
      }
      return { at: e.occurred_at, text };
    });
    return item;
  });

  app.patch('/api/people/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const row = scopedPerson(org, session, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const body = stripOrg(request.body);
    const { fields, value } = validatePerson(body, { create: false });
    if (body.email === undefined && body.phone === undefined) {
      delete fields.email;
      delete fields.phone;
    } else {
      const nextEmail = value.email === undefined ? row.email : value.email;
      const nextPhone = value.phone === undefined ? row.phone : value.phone;
      if (!nextEmail && !nextPhone) {
        fields.email = fields.email || 'Email or phone is required';
        fields.phone = fields.phone || 'Email or phone is required';
      } else {
        if (fields.email === 'Email or phone is required') delete fields.email;
        if (fields.phone === 'Email or phone is required') delete fields.phone;
      }
    }
    if (Object.keys(fields).length) {
      return sendError(reply, 400, 'validation_failed', { fields });
    }
    const extras = personExtras(org, id);
    if (session.role !== 'fsm' && value.fsmUserId !== undefined && value.fsmUserId != null) {
      if (!resolveFsmUser(org, value.fsmUserId, { allowInactiveId: extras.fsmUserId })) {
        return sendError(reply, 400, 'validation_failed', { fields: { fsmUserId: 'Unknown FSM' } });
      }
    }
    const firstName = value.firstName || row.first_name;
    const lastName = value.lastName || row.last_name;
    const at = nowIso(app.db);
    try {
      app.db.prepare(`
        UPDATE people SET
           first_name = ?, last_name = ?, display_name = ?, email = ?, phone = ?,
           postal_code = ?, source = ?, stage = ?, ruin_category = ?, updated_at = ?
         WHERE org_id = ? AND id = ?
      `).run(
        firstName,
        lastName,
        `${firstName} ${lastName}`,
        value.email === undefined ? row.email : value.email,
        value.phone === undefined ? row.phone : value.phone,
        value.postalCode === undefined ? row.postal_code : value.postalCode,
        value.source === undefined ? row.source : value.source,
        value.stage && STAGES.has(value.stage) ? value.stage : row.stage,
        value.ruinCategory === undefined ? row.ruin_category : value.ruinCategory,
        at,
        session.orgId,
        id,
      );
    } catch (err) {
      if (uniqueConflict(err)) {
        return sendError(reply, 409, 'conflict', { message: 'Email already exists' });
      }
      throw err;
    }
    if (session.role !== 'fsm' && Object.prototype.hasOwnProperty.call(body, 'fsmUserId')) {
      setFsmAssignment(app.db, session.orgId, id, value.fsmUserId, at);
    }
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'person.update',
      entityType: 'person',
      entityId: id,
    });
    return hydratePerson(org, loadPersonRow(org, id));
  });

  app.get('/api/people/:id/engagements', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    if (!scopedPerson(org, session, id)) return sendError(reply, 404, 'not_found');
    const rows = org.all(
      `SELECT id, type, occurred_at, minutes_attended, payload_json
         FROM engagements
        WHERE org_id = ? AND person_id = ?
        ORDER BY occurred_at ASC, id ASC`,
      [id],
    );
    return {
      items: rows.map((r) => {
        let payload = null;
        if (r.payload_json) {
          try { payload = JSON.parse(r.payload_json); } catch { payload = r.payload_json; }
        }
        return {
          id: r.id,
          type: r.type,
          occurredAt: r.occurred_at,
          minutesAttended: r.minutes_attended,
          payload,
        };
      }),
    };
  });

  app.post('/api/people/:id/merge', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const winnerId = Number(request.params.id);
    const body = stripOrg(request.body);
    const loserId = Number(body.loserId);
    if (!Number.isInteger(winnerId) || !Number.isInteger(loserId) || winnerId === loserId) {
      return sendError(reply, 400, 'validation_failed', { fields: { loserId: 'Invalid merge target' } });
    }
    const winner = loadPersonRow(org, winnerId);
    const loser = loadPersonRow(org, loserId);
    if (!winner || !loser) return sendError(reply, 404, 'not_found');
    const at = nowIso(app.db);
    try {
      const apply = app.db.transaction(() => {
        mergePeople(app.db, session.orgId, winnerId, loserId, at);
      });
      apply();
    } catch (err) {
      if (uniqueConflict(err)) {
        return sendError(reply, 409, 'conflict', { message: 'Email already exists' });
      }
      throw err;
    }
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'person.merge',
      entityType: 'person',
      entityId: winnerId,
      after: { winnerId, loserId },
    });
    return { winnerId, loserId };
  });

  app.post('/api/people/:id/send-link', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const person = scopedPerson(org, session, id);
    if (!person) return sendError(reply, 404, 'not_found');
    // Missing followup consent does not block send-link; only global suppression does.
    if (person.suppressed) return sendError(reply, 409, 'suppressed');
    const body = stripOrg(request.body);
    const at = nowIso(app.db);
    const startAt = typeof body.startAt === 'string' && body.startAt
      ? body.startAt
      : shiftIso(at, 12 * 60 * 60 * 1000);
    const extras = personExtras(org, id);
    const fsmUserId = session.role === 'fsm'
      ? session.userId
      : (extras.fsmUserId || session.userId);
    const token = randomBytes(32).toString('base64url');
    const info = org.run(
      `INSERT INTO appointments (
         org_id, person_id, fsm_user_id, campaign_id, start_at, timezone,
         duration_min, status, offer_token, action_due, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 45, 'Offered', ?, 'Link expires in 2 d', ?)`,
      [
        id,
        fsmUserId,
        extras.eventId,
        startAt,
        session.orgTimezone || 'America/Chicago',
        token,
        at,
      ],
    );
    const appointmentId = Number(info.lastInsertRowid);
    org.run(
      `INSERT INTO engagements (org_id, person_id, campaign_id, type, occurred_at, payload_json, created_by)
       VALUES (?, ?, ?, 'link_sent', ?, ?, ?)`,
      [id, extras.eventId, at, JSON.stringify({ text: 'Scheduling link sent' }), session.userId],
    );
    app.db.prepare(`
      UPDATE people SET stage = 'Scheduled', updated_at = ?
       WHERE org_id = ? AND id = ?
    `).run(at, session.orgId, id);
    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'person.send_link',
      entityType: 'person',
      entityId: id,
      after: { appointmentId, offerToken: token },
    });
    const row = org.get(`SELECT * FROM appointments WHERE org_id = ? AND id = ?`, [appointmentId]);
    const offerUrl = `/scheduling?offer=${token}`;
    return { appointment: appointmentDto(org, row), offerUrl };
  });

  app.get('/api/scheduling/offer/:token', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const row = loadAppointmentByToken(org, session, request.params.token);
    if (!row) return sendError(reply, 404, 'not_found');
    return offerPayload(org, session, row);
  });
}
