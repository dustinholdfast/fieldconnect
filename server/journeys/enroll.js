import { now, nowIso } from '../clock.js';
import { scheduleAt } from './timing.js';

export function sendOutbound() {
  return { provider: 'local', status: 'recorded' };
}

export function enroll(db, { orgId, personId, journeyKey, branch = null } = {}) {
  if (orgId == null) throw new Error('enroll requires orgId');
  if (personId == null) throw new Error('enroll requires personId');
  if (!journeyKey) throw new Error('enroll requires journeyKey');

  const existing = db.prepare(`
    SELECT id, status FROM enrollments
     WHERE org_id = ? AND person_id = ? AND journey_key = ? AND status = 'active'
     ORDER BY id DESC LIMIT 1
  `).get(orgId, personId, journeyKey);
  if (existing) {
    return { id: existing.id, status: 'active', sent: [], reused: true };
  }

  const person = db.prepare(`
    SELECT suppressed FROM people WHERE org_id = ? AND id = ?
  `).get(orgId, personId);
  if (person?.suppressed) {
    return { id: null, status: 'suppressed', sent: [] };
  }

  const journey = db.prepare(`
    SELECT key FROM journeys WHERE org_id = ? AND key = ?
  `).get(orgId, journeyKey);
  if (!journey) {
    return { id: null, status: 'unknown_journey', sent: [] };
  }

  const at = nowIso(db);
  const enrolledAt = now(db);
  const tzRow = db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(orgId);
  const tz = tzRow?.timezone || 'America/Chicago';

  const apply = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO enrollments (org_id, person_id, journey_key, branch, status, enrolled_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `).run(orgId, personId, journeyKey, branch, at);
    const enrollmentId = Number(info.lastInsertRowid);
    const steps = db.prepare(`
      SELECT id, timing, channel FROM journey_steps
       WHERE journey_key = ?
       ORDER BY sort_order ASC, id ASC
    `).all(journeyKey);
    for (const step of steps) {
      const when = scheduleAt(enrolledAt, step.timing, tz);
      db.prepare(`
        INSERT INTO outbound_messages (
          org_id, enrollment_id, step_id, channel, status, scheduled_at
        ) VALUES (?, ?, ?, ?, 'queued', ?)
      `).run(orgId, enrollmentId, step.id, step.channel || 'Email', when.toISOString());
    }
    return enrollmentId;
  });

  return { id: apply(), status: 'active', sent: [] };
}

export function exitEnrollment(db, enrollmentId, reason, at) {
  db.prepare(`
    UPDATE enrollments
       SET status = 'exited', exit_reason = ?, exited_at = ?
     WHERE id = ? AND status = 'active'
  `).run(reason, at, enrollmentId);
  db.prepare(`
    UPDATE outbound_messages
       SET status = 'skipped_cap'
     WHERE enrollment_id = ? AND status = 'queued'
  `).run(enrollmentId);
}
