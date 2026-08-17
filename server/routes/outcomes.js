import { write as writeAudit } from '../audit.js';
import { nowIso } from '../clock.js';
import { withOrg } from '../db.js';
import { enrollIfNeeded } from '../journeys/engine.js';
import { assignJourney } from '../../shared/outcome/assignJourney.js';
import { validateOutcome } from '../../shared/outcome/validate.js';

const WRITABLE = new Set(['Booked', 'Confirmed', 'Reminder due', 'Partial']);
const CHANNEL_FROM_PREF = {
  email: 'email',
  Email: 'email',
  sms: 'sms',
  SMS: 'sms',
  phone: 'sms',
  Phone: 'sms',
};

function stripOrg(body) {
  if (!body || typeof body !== 'object') return {};
  const { org_id: _orgIdSnake, orgId: _orgIdCamel, ...rest } = body;
  return rest;
}

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function headerClientId(request) {
  const raw = request.headers['idempotency-key'];
  return typeof raw === 'string' ? raw.trim() : '';
}

function loadAppointment(org, id) {
  return org.get(
    `SELECT a.*,
            p.display_name AS person_name,
            p.preferred_channel AS preferred_channel,
            p.stage AS person_stage,
            p.journey_key AS person_journey_key,
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

function loadCatalog(org) {
  return org.all(
    `SELECT id, sku, name, kind, list_price_cents, currency
       FROM products
      WHERE org_id = ? AND active = 1
      ORDER BY id ASC`,
  ).map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    kind: row.kind,
    listPriceCents: row.list_price_cents,
    currency: row.currency,
  }));
}

function loadPathways(org) {
  const set = org.get(
    `SELECT id, version, status
       FROM pathway_sets
      WHERE org_id = ? AND status = 'approved'
      ORDER BY version DESC
      LIMIT 1`,
  );
  if (!set) return { version: 0, status: 'none', items: [] };
  const items = org.all(
    `SELECT pi.ruin_category, pi.label, pi.detail, pi.product_id, pi.sort_order
       FROM pathway_sets ps
       JOIN pathway_items pi ON pi.pathway_set_id = ps.id
      WHERE ps.org_id = ? AND ps.id = ?
      ORDER BY pi.sort_order ASC`,
    [set.id],
  ).map((row) => ({
    ruinCategory: row.ruin_category,
    label: row.label,
    detail: row.detail,
    productId: row.product_id,
    sortOrder: row.sort_order,
  }));
  return { version: set.version, status: set.status, items };
}

function existingOutcome(org, appointmentId) {
  return org.get(
    `SELECT id, client_id FROM outcomes WHERE org_id = ? AND appointment_id = ?`,
    [appointmentId],
  );
}

function loadSubmission(org, clientId) {
  return org.get(
    `SELECT client_id, appointment_id, status_code, response_json
       FROM outcome_submissions
      WHERE org_id = ? AND client_id = ?`,
    [clientId],
  );
}

function appointmentDto(row) {
  return {
    id: row.id,
    status: row.status,
    personId: row.person_id,
    personName: row.person_name,
    actualDurationMin: row.actual_duration_min,
    partialReason: row.partial_reason,
  };
}

function lineItemsFromBody(body, catalog) {
  const raw = Array.isArray(body.lineItems) ? body.lineItems : [];
  return raw.map((item) => {
    const product = catalog.find((p) => p.id === item.productId || p.sku === item.sku);
    return {
      productId: item.productId ?? product?.id,
      sku: item.sku || product?.sku,
      name: item.name || product?.name,
      kind: product?.kind || item.kind,
      qty: Number(item.qty) || 0,
      listPriceCents: product?.listPriceCents ?? item.listPriceCents ?? item.list_price_cents,
      unitPriceCents: item.unitPriceCents ?? item.unit_price_cents ?? product?.listPriceCents,
      overrideReason: item.overrideReason || null,
    };
  });
}

function durationOf(body) {
  if (body.durationMin != null && body.durationMin !== '') return Number(body.durationMin);
  if (body.duration != null && body.duration !== '') return Number(body.duration);
  return null;
}

function upsertConsent(db, orgId, personId, channel, granted, at) {
  const existing = db.prepare(
    `SELECT id FROM consent_records WHERE org_id = ? AND person_id = ? AND channel = ?`,
  ).get(orgId, personId, channel);
  if (existing) {
    db.prepare(
      `UPDATE consent_records
          SET granted = ?, granted_at = ?, withdrawn_at = ?, source = 'outcome'
        WHERE org_id = ? AND id = ?`,
    ).run(granted ? 1 : 0, granted ? at : null, granted ? null : at, orgId, existing.id);
    return;
  }
  if (!granted) return;
  db.prepare(
    `INSERT INTO consent_records (org_id, person_id, channel, granted, granted_at, source)
     VALUES (?, ?, ?, 1, ?, 'outcome')`,
  ).run(orgId, personId, channel, at);
}

function writeConsents(db, orgId, person, consents, at) {
  const flags = consents && typeof consents === 'object' ? consents : {};
  upsertConsent(db, orgId, person.id, 'followup', !!flags.followup, at);
  upsertConsent(db, orgId, person.id, 'testimonial', !!flags.testimonial, at);
  upsertConsent(db, orgId, person.id, 'public_story', !!flags.publicStory, at);
  if (flags.followup) {
    const pref = CHANNEL_FROM_PREF[person.preferred_channel] || null;
    if (pref) upsertConsent(db, orgId, person.id, pref, true, at);
  }
}

function outcomeDto(row, extras = {}) {
  return {
    id: row.id,
    appointmentId: row.appointment_id,
    personId: row.person_id,
    fsmUserId: row.fsm_user_id,
    delivered: row.delivered,
    durationMin: row.duration_min,
    result: row.result,
    channel: row.channel,
    ruinCategory: row.ruin_category,
    desired: row.desired,
    ruinNotes: row.ruin_notes,
    pathwayLabel: row.pathway_label,
    objection: row.objection,
    storySignal: row.story_signal,
    nextAction: row.next_action,
    nextDue: row.next_due,
    clientId: row.client_id,
    createdAt: row.created_at,
    derivedStatus: extras.derivedStatus,
    journeyKey: extras.journeyKey,
    revenueCents: extras.revenueCents ?? 0,
    lineItems: extras.lineItems || [],
  };
}

function loadOutcomeRow(org, id) {
  return org.get(
    `SELECT * FROM outcomes WHERE org_id = ? AND id = ?`,
    [id],
  );
}

function loadOutcomeLines(org, outcomeId) {
  return org.all(
    `SELECT oli.product_id, oli.qty, oli.unit_price_cents, oli.list_price_cents, oli.override_reason,
            p.sku, p.name, p.kind
       FROM outcome_line_items oli
       JOIN products p ON p.id = oli.product_id AND p.org_id = ?
      WHERE oli.outcome_id = ?`,
    [outcomeId],
  ).map((row) => ({
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    kind: row.kind,
    qty: row.qty,
    unitPriceCents: row.unit_price_cents,
    listPriceCents: row.list_price_cents,
    overrideReason: row.override_reason,
  }));
}

export async function registerOutcomeRoutes(app) {
  app.get('/api/catalog', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    return { items: loadCatalog(org) };
  });

  app.get('/api/pathways', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    return loadPathways(org);
  });

  app.get('/api/outcomes/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const row = loadOutcomeRow(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    if (session.role === 'fsm' && row.fsm_user_id !== session.userId) {
      return sendError(reply, 404, 'not_found');
    }
    const lines = loadOutcomeLines(org, row.id);
    const catalog = loadCatalog(org);
    const journey = assignJourney({
      delivered: row.delivered,
      result: row.result,
      lineItems: lines,
    }, catalog);
    const revenueCents = lines.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
    return outcomeDto(row, {
      derivedStatus: row.delivered === 'no' ? 'No-show' : 'Completed',
      journeyKey: journey.key,
      revenueCents,
      lineItems: lines,
    });
  });

  app.post('/api/outcomes', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const body = stripOrg(request.body);
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const headerKey = headerClientId(request);
    if (!clientId || !headerKey || headerKey !== clientId) {
      return sendError(reply, 400, 'idempotency_mismatch');
    }

    const replay = loadSubmission(org, clientId);
    if (replay) {
      let payload = null;
      try { payload = JSON.parse(replay.response_json); } catch { payload = null; }
      return reply.code(200).send(payload);
    }

    const catalog = loadCatalog(org);
    const pathways = loadPathways(org);
    const lineItems = lineItemsFromBody(body, catalog);
    const input = {
      ...body,
      clientId,
      appointmentId: body.appointmentId,
      lineItems,
    };
    const checked = validateOutcome(input, catalog, pathways.items);
    if (!checked.ok) {
      return sendError(reply, 400, 'validation_failed', { fields: checked.errors });
    }

    const appointmentId = Number(body.appointmentId);
    const appt = scopedAppointment(org, session, appointmentId);
    if (!appt) return sendError(reply, 404, 'not_found');
    if (!WRITABLE.has(appt.status)) {
      return sendError(reply, 409, 'conflict');
    }

    const prior = existingOutcome(org, appointmentId);
    if (prior) {
      return sendError(reply, 409, 'conflict');
    }

    const at = nowIso(app.db);
    const delivered = body.delivered;
    const durationMin = durationOf(body);
    const result = delivered === 'no' ? 'No-show' : (body.result || null);
    const pathwayLabel = body.pathwayLabel || body.pathway || null;
    const nextAction = body.nextAction || body.next || null;
    const nextDue = body.nextDue || body.due || null;
    const sold = delivered === 'yes' && result !== 'Not a fit'
      ? lineItems.filter((item) => item.qty > 0)
      : [];
    const journey = assignJourney({ delivered, result, lineItems: sold }, catalog);
    const revenueCents = sold.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);

    const apply = app.db.transaction(() => {
      if (delivered === 'partial') {
        app.db.prepare(
          `UPDATE appointments
              SET status = 'Partial',
                  actual_duration_min = ?,
                  partial_reason = ?,
                  action_due = 'Finish outcome form'
            WHERE org_id = ? AND id = ?`,
        ).run(durationMin, String(body.partialReason || '').trim(), session.orgId, appointmentId);
        org.run(
          `INSERT INTO engagements (
             org_id, person_id, campaign_id, type, occurred_at, minutes_attended, payload_json, created_by
           ) VALUES (?, ?, ?, 'partial_recorded', ?, ?, ?, ?)`,
          [
            appt.person_id,
            appt.campaign_id,
            at,
            durationMin,
            JSON.stringify({ delivered: 'partial' }),
            session.userId,
          ],
        );
        writeAudit(app.db, {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: 'outcome.partial',
          entityType: 'appointment',
          entityId: appointmentId,
          after: { status: 'Partial', delivered: 'partial' },
        });
        const next = loadAppointment(org, appointmentId);
        const response = { appointment: appointmentDto(next), outcome: null };
        org.run(
          `INSERT INTO outcome_submissions (
             org_id, client_id, appointment_id, status_code, response_json, created_at
           ) VALUES (?, ?, ?, 201, ?, ?)`,
          [clientId, appointmentId, JSON.stringify(response), at],
        );
        return response;
      }

      const personStage = delivered === 'no'
        ? 'No-show'
        : result === 'Not a fit' ? 'Not a fit' : 'Completed';
      const apptStatus = delivered === 'no' ? 'No-show' : 'Completed';
      const actionDue = delivered === 'no' ? 'Rescheduling path sent' : 'Outcome recorded';

      const info = org.run(
        `INSERT INTO outcomes (
           org_id, appointment_id, person_id, fsm_user_id, delivered, duration_min,
           result, channel, ruin_category, desired, ruin_notes, pathway_label,
           objection, story_signal, next_action, next_due, client_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          appointmentId,
          appt.person_id,
          session.userId,
          delivered,
          delivered === 'no' ? null : durationMin,
          result,
          body.channel || null,
          body.ruinCategory || body.ruinCat || null,
          body.desired || null,
          body.ruinNotes || null,
          pathwayLabel,
          body.objection || null,
          body.storySignal || null,
          nextAction,
          nextDue,
          clientId,
          at,
        ],
      );
      const outcomeId = Number(info.lastInsertRowid);

      for (const item of sold) {
        // outcome_line_items has no org_id; do not use withOrg (it prepends orgId).
        app.db.prepare(
          `INSERT INTO outcome_line_items (
             outcome_id, product_id, qty, unit_price_cents, list_price_cents, override_reason
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          outcomeId,
          item.productId,
          item.qty,
          item.unitPriceCents,
          item.listPriceCents,
          item.unitPriceCents !== item.listPriceCents ? (item.overrideReason || null) : null,
        );
      }

      app.db.prepare(
        `UPDATE appointments
            SET status = ?, actual_duration_min = ?, action_due = ?
          WHERE org_id = ? AND id = ?`,
      ).run(apptStatus, delivered === 'no' ? null : durationMin, actionDue, session.orgId, appointmentId);

      app.db.prepare(
        `UPDATE people
            SET stage = ?, journey_key = ?, updated_at = ?
          WHERE org_id = ? AND id = ?`,
      ).run(personStage, journey.key, at, session.orgId, appt.person_id);

      org.run(
        `INSERT INTO engagements (
           org_id, person_id, campaign_id, type, occurred_at, minutes_attended, payload_json, created_by
         ) VALUES (?, ?, ?, 'outcome_recorded', ?, ?, ?, ?)`,
        [
          appt.person_id,
          appt.campaign_id,
          at,
          delivered === 'no' ? null : durationMin,
          JSON.stringify({ delivered, result, journeyKey: journey.key }),
          session.userId,
        ],
      );

      const person = org.get(`SELECT * FROM people WHERE org_id = ? AND id = ?`, [appt.person_id]);
      writeConsents(app.db, session.orgId, person, body.consents, at);

      if (nextAction) {
        org.run(
          `INSERT INTO assignments (
             org_id, person_id, user_id, kind, status, due_at, notes, created_at
           ) VALUES (?, ?, ?, 'follow_up', 'open', ?, ?, ?)`,
          [appt.person_id, session.userId, nextDue, nextAction, at],
        );
      }

      writeAudit(app.db, {
        orgId: session.orgId,
        actorUserId: session.userId,
        action: 'outcome.create',
        entityType: 'outcome',
        entityId: outcomeId,
        after: {
          delivered,
          result,
          pathway_label: pathwayLabel,
          product_skus: sold.map((item) => item.sku).filter(Boolean).join(';'),
          revenue_cents: revenueCents,
        },
      });

      const next = loadAppointment(org, appointmentId);
      const response = {
        appointment: appointmentDto(next),
        outcome: {
          id: outcomeId,
          derivedStatus: checked.derived.status,
          journeyKey: journey.key,
          revenueCents,
        },
      };
      org.run(
        `INSERT INTO outcome_submissions (
           org_id, client_id, appointment_id, status_code, response_json, created_at
         ) VALUES (?, ?, ?, 201, ?, ?)`,
        [clientId, appointmentId, JSON.stringify(response), at],
      );
      return response;
    });

    const response = apply();
    if (response?.outcome?.journeyKey) {
      enrollIfNeeded(app.db, {
        orgId: session.orgId,
        personId: appt.person_id,
        journeyKey: response.outcome.journeyKey,
        branch: body.objection || null,
      });
    }
    return reply.code(201).send(response);
  });
}
