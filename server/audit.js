import { nowIso } from './clock.js';

const REDACT = new Set(['ruin_notes', 'desired', 'ruinNotes']);

function sanitize(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (REDACT.has(key)) continue;
    out[key] = sanitize(nested);
  }
  return out;
}

// Insert-only: there is no update/delete API for audit_log.
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
    before == null ? null : JSON.stringify(sanitize(before)),
    after == null ? null : JSON.stringify(sanitize(after)),
    nowIso(db),
  );
}
