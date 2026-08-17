import { enqueue, KIND_RECONCILE } from '../jobs/runner.js';
import { isLevel2Enabled, setLevel2Enabled } from '../metapulse/adapter.js';

function stripOrg(body) {
  if (!body || typeof body !== 'object') return {};
  const { org_id: _orgIdSnake, orgId: _orgIdCamel, ...rest } = body;
  return rest;
}

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function integrationBody(db, orgId) {
  const last = db.prepare(`
    SELECT row_count, created_at, filename
      FROM exports
     WHERE org_id = ? AND kind IN ('metapulse_l1', 'metapulse_export')
     ORDER BY id DESC
     LIMIT 1
  `).get(orgId);
  let skipped = 0;
  if (last) {
    const job = db.prepare(`
      SELECT result_json FROM jobs
       WHERE org_id = ? AND kind IN ('metapulse_l1', 'metapulse_export') AND status = 'done'
       ORDER BY id DESC LIMIT 1
    `).get(orgId);
    if (job?.result_json) {
      try {
        const parsed = JSON.parse(job.result_json);
        if (Number.isFinite(parsed.skipped)) skipped = parsed.skipped;
      } catch { /* ignore */ }
    }
  }
  return {
    level1: process.env.METAPULSE_L1_ENABLED === 'false' ? 'disabled' : 'active',
    level2: isLevel2Enabled(db, orgId) ? 'live' : 'off',
    level3: isLevel2Enabled(db, orgId) ? 'scheduled' : 'paused',
    lastExport: last
      ? { rows: last.row_count, skipped, at: last.created_at, filename: last.filename }
      : null,
  };
}

function wantsLevel2(body) {
  const value = body.level2 ?? body.adapterOn ?? body.enabled;
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const n = value.trim().toLowerCase();
  return n === 'enabled' || n === 'live' || n === 'on' || n === 'true' || n === 'active';
}

export async function registerAdminRoutes(app) {
  app.get('/api/orgs', async () => {
    const items = app.db.prepare(`
      SELECT o.id, o.slug, o.name, o.wave, o.status, o.metapulse_map,
             (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS userCount,
             (SELECT COUNT(*) FROM people p WHERE p.org_id = o.id AND p.merged_into_id IS NULL) AS contactCount
        FROM organizations o
       ORDER BY o.id ASC
    `).all().map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      wave: row.wave,
      status: row.status,
      userCount: row.userCount,
      contactCount: row.contactCount,
      metapulseMap: row.metapulse_map,
    }));
    return { items };
  });

  app.get('/api/admin/integration', async (request) => {
    return integrationBody(app.db, request.fcSession.orgId);
  });

  app.post('/api/admin/integration', async (request, reply) => {
    const body = stripOrg(request.body);
    const enable = wantsLevel2(body);
    setLevel2Enabled(app.db, request.fcSession.orgId, enable);
    if (enable) {
      enqueue(app.db, { orgId: request.fcSession.orgId, kind: KIND_RECONCILE });
    }
    return integrationBody(app.db, request.fcSession.orgId);
  });
}
