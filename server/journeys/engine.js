import { now, nowIso } from '../clock.js';
import { enroll, exitEnrollment, sendOutbound } from './enroll.js';
import { freqCapMs, isQuietHour } from './timing.js';

const ATTENDED_WAIT_MS = 5 * 86400_000;

function orgTz(db, orgId) {
  return db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(orgId)?.timezone
    || 'America/Chicago';
}

export function enrollIfNeeded(db, { orgId, personId, journeyKey, branch = null }) {
  if (!journeyKey || !String(journeyKey).startsWith('j')) return null;
  return enroll(db, { orgId, personId, journeyKey, branch });
}

export function enrollAttendedUnbooked(db, orgId) {
  const tz = orgTz(db, orgId);
  const nowMs = now(db).getTime();
  const people = db.prepare(`
    SELECT p.id
      FROM people p
     WHERE p.org_id = ?
       AND p.merged_into_id IS NULL
       AND p.suppressed = 0
       AND p.stage = 'Attended'
       AND NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.org_id = p.org_id AND a.person_id = p.id
            AND a.status NOT IN ('Cancelled')
       )
       AND NOT EXISTS (
         SELECT 1 FROM enrollments e
          WHERE e.org_id = p.org_id AND e.person_id = p.id
            AND e.journey_key = 'j1' AND e.status = 'active'
       )
  `).all(orgId);
  let created = 0;
  for (const person of people) {
    const attended = db.prepare(`
      SELECT occurred_at FROM engagements
       WHERE org_id = ? AND person_id = ? AND type IN ('attended', 'history')
       ORDER BY occurred_at ASC LIMIT 1
    `).get(orgId, person.id);
    const when = attended ? Date.parse(attended.occurred_at) : NaN;
    if (!Number.isFinite(when) || nowMs - when < ATTENDED_WAIT_MS) continue;
    const result = enroll(db, { orgId, personId: person.id, journeyKey: 'j1' });
    if (result?.id && !result.reused) created += 1;
  }
  return { created, timezone: tz };
}

function lastSentMs(db, orgId, personId) {
  const row = db.prepare(`
    SELECT MAX(m.sent_at) AS sent_at
      FROM outbound_messages m
      JOIN enrollments e ON e.id = m.enrollment_id
     WHERE m.org_id = ? AND e.person_id = ? AND m.status = 'sent'
  `).get(orgId, personId);
  const ms = row?.sent_at ? Date.parse(row.sent_at) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function deliverDue(db, orgId) {
  const tz = orgTz(db, orgId);
  const nowDate = now(db);
  const nowMs = nowDate.getTime();
  const at = nowIso(db);
  const due = db.prepare(`
    SELECT m.id, m.enrollment_id, m.channel, m.scheduled_at,
           e.person_id, e.journey_key, j.freq_cap
      FROM outbound_messages m
      JOIN enrollments e ON e.id = m.enrollment_id
      JOIN journeys j ON j.key = e.journey_key AND j.org_id = e.org_id
     WHERE m.org_id = ? AND m.status = 'queued' AND e.status = 'active'
       AND m.scheduled_at <= ?
     ORDER BY m.scheduled_at ASC, m.id ASC
  `).all(orgId, nowDate.toISOString());

  let sent = 0;
  let skipped = 0;
  for (const row of due) {
    const person = db.prepare(`
      SELECT suppressed, stage FROM people WHERE org_id = ? AND id = ?
    `).get(orgId, row.person_id);
    if (!person || person.suppressed) {
      db.prepare(`UPDATE outbound_messages SET status = 'suppressed' WHERE id = ?`).run(row.id);
      exitEnrollment(db, row.enrollment_id, 'suppressed', at);
      skipped += 1;
      continue;
    }
    if (row.journey_key === 'j1' && person.stage === 'Scheduled') {
      exitEnrollment(db, row.enrollment_id, 'booked', at);
      skipped += 1;
      continue;
    }
    if (isQuietHour(nowDate, tz)) {
      skipped += 1;
      continue;
    }
    const cap = freqCapMs(row.freq_cap);
    const last = lastSentMs(db, orgId, row.person_id);
    if (cap && last && nowMs - last < cap) {
      skipped += 1;
      continue;
    }
    sendOutbound();
    db.prepare(`
      UPDATE outbound_messages SET status = 'sent', sent_at = ? WHERE id = ?
    `).run(at, row.id);
    sent += 1;

    const remaining = db.prepare(`
      SELECT COUNT(*) AS c FROM outbound_messages
       WHERE enrollment_id = ? AND status = 'queued'
    `).get(row.enrollment_id).c;
    if (remaining === 0) {
      exitEnrollment(db, row.enrollment_id, 'completed', at);
    }
  }
  return { sent, skipped };
}

export function tickOrg(db, orgId) {
  const attended = enrollAttendedUnbooked(db, orgId);
  const delivered = deliverDue(db, orgId);
  return { ...attended, ...delivered };
}
