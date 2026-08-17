import { withOrg } from '../db.js';

function clampLimit(raw) {
  const n = Number.parseInt(raw ?? '20', 10);
  if (!Number.isFinite(n) || n < 1) return 20;
  return Math.min(n, 100);
}

export async function registerAuditRoutes(app) {
  app.get('/api/audit', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const limit = clampLimit(request.query?.limit);
    const items = org.all(`
      SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id,
             u.display_name AS actor_name
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id AND u.org_id = a.org_id
       WHERE a.org_id = ?
       ORDER BY a.id DESC
       LIMIT ?
    `, [limit]).map((row) => ({
      id: row.id,
      at: row.created_at,
      actorName: row.actor_name || 'System',
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
    }));
    return { items };
  });
}
