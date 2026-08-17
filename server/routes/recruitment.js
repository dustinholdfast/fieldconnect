import { recruitmentBoardFromDb, RECRUIT_STAGES } from '../fixtures/demo.js';
import { withOrg } from '../db.js';

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function loadCandidate(org, id) {
  return org.get(
    `SELECT id, name, source, stage FROM candidates WHERE org_id = ? AND id = ?`,
    [id],
  );
}

function nextStage(stage) {
  const idx = RECRUIT_STAGES.indexOf(stage);
  if (idx === -1) return RECRUIT_STAGES[0];
  return RECRUIT_STAGES[Math.min(idx + 1, RECRUIT_STAGES.length - 1)];
}

export async function registerRecruitmentRoutes(app) {
  app.get('/api/recruitment', async (request) => {
    return recruitmentBoardFromDb(app.db, request.fcSession.orgId);
  });

  app.post('/api/recruitment/candidates/:id/advance', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadCandidate(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const stage = nextStage(row.stage);
    app.db.prepare(`UPDATE candidates SET stage = ? WHERE org_id = ? AND id = ?`)
      .run(stage, request.fcSession.orgId, id);
    return loadCandidate(org, id);
  });

  app.post('/api/recruitment/candidates/:id', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadCandidate(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const stage = String(request.body?.stage || '');
    if (!RECRUIT_STAGES.includes(stage)) {
      return sendError(reply, 400, 'validation_failed', { fields: { stage: 'Unknown stage' } });
    }
    app.db.prepare(`UPDATE candidates SET stage = ? WHERE org_id = ? AND id = ?`)
      .run(stage, request.fcSession.orgId, id);
    return loadCandidate(org, id);
  });
}
