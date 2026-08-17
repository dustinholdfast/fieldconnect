import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { withOrg } from '../db.js';
import { enqueue, KIND_METAPULSE_L1, runOnce } from '../jobs/runner.js';

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function l1Enabled() {
  return process.env.METAPULSE_L1_ENABLED !== 'false';
}

function safeName(name) {
  const base = basename(String(name || 'metapulse-l1.csv'));
  return /[\r\n"]/.test(base) ? 'metapulse-l1.csv' : base;
}

function exportDto(row) {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    rowCount: row.row_count,
    createdAt: row.created_at,
    jobId: row.job_id,
  };
}

function sendCsv(reply, row) {
  if (!existsSync(row.stored_path)) {
    return sendError(reply, 404, 'not_found');
  }
  reply.header('Content-Disposition', `attachment; filename="${safeName(row.filename)}"`);
  return reply.type('text/csv; charset=utf-8').send(readFileSync(row.stored_path));
}

export async function registerExportRoutes(app) {
  app.post('/api/exports/metapulse', async (request, reply) => {
    if (!l1Enabled()) {
      return sendError(reply, 409, 'conflict', { message: 'MetaPulse Level 1 is disabled' });
    }
    const session = request.fcSession;
    const jobId = enqueue(app.db, {
      orgId: session.orgId,
      kind: KIND_METAPULSE_L1,
      payload: { actorUserId: session.userId },
    });
    // Kick one job without blocking this response (and without blocking /healthz).
    setImmediate(() => {
      try { runOnce(app.db, { dataDir: app.dataDir }); } catch { /* next poller tick */ }
    });
    return reply.code(202).send({ jobId });
  });

  app.get('/api/exports', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = org.all(`
      SELECT id, job_id, kind, filename, row_count, created_at
        FROM exports
       WHERE org_id = ?
       ORDER BY id DESC
    `).map(exportDto);
    return { items };
  });

  app.get('/api/exports/:id/download', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    const row = org.get(`
      SELECT id, filename, stored_path FROM exports WHERE org_id = ? AND id = ?
    `, [id]);
    if (!row) return sendError(reply, 404, 'not_found');
    return sendCsv(reply, row);
  });

  app.get('/api/exports/:id', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    const row = org.get(`
      SELECT id, filename, stored_path FROM exports WHERE org_id = ? AND id = ?
    `, [id]);
    if (!row) return sendError(reply, 404, 'not_found');
    return sendCsv(reply, row);
  });
}
