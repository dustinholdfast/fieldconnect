import { withOrg } from '../db.js';

export const STAGE_ORDER = [
  'Submitted',
  'Screened',
  'Interview requested',
  'Recorded',
  'Drafted',
  'Consent pending',
  'Approved',
  'Published',
];

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function nextStage(stage) {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1) return STAGE_ORDER[0];
  return STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
}

function mapStory(row) {
  return {
    id: row.id,
    contributor: row.contributor,
    source: row.source,
    summary: row.summary,
    stage: row.stage,
    release: row.release,
    next: nextStage(row.stage),
  };
}

function loadStory(org, id) {
  return org.get(
    `SELECT id, contributor, source, summary, stage, release
       FROM stories
      WHERE org_id = ? AND id = ?`,
    [id],
  );
}

export async function registerStoryRoutes(app) {
  app.get('/api/stories', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = org.all(`
      SELECT id, contributor, source, summary, stage, release
        FROM stories
       WHERE org_id = ?
       ORDER BY id ASC
    `).map(mapStory);
    return { items };
  });

  app.post('/api/stories/:id/advance', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadStory(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    // Consent enforcement is Wave 2; Pilot only persists the next stage.
    const stage = nextStage(row.stage);
    app.db.prepare(`UPDATE stories SET stage = ? WHERE org_id = ? AND id = ?`)
      .run(stage, request.fcSession.orgId, id);
    return { id, stage, next: nextStage(stage) };
  });
}
