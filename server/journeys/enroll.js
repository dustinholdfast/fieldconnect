import { nowIso } from '../clock.js';
import { NotImplemented } from '../metapulse/adapter.js';

export function sendOutbound(_message) {
  throw NotImplemented('wave-2');
}

export function enroll(db, { orgId, personId, journeyKey, branch = null } = {}) {
  if (orgId == null) throw new Error('enroll requires orgId');
  if (personId == null) throw new Error('enroll requires personId');
  if (!journeyKey) throw new Error('enroll requires journeyKey');

  const at = nowIso(db);
  const info = db.prepare(`
    INSERT INTO enrollments (org_id, person_id, journey_key, branch, status, enrolled_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(orgId, personId, journeyKey, branch, at);

  return {
    id: Number(info.lastInsertRowid),
    status: 'active',
    sent: [],
  };
}
