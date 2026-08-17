import { nowIso } from './clock.js';

export function write(db, { orgId, actorUserId, action, entityType, entityId, before, after }) {
  db.prepare(`
    INSERT INTO audit_log (
      org_id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    actorUserId ?? null,
    action,
    entityType,
    entityId == null ? null : String(entityId),
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    nowIso(db),
  );
}
