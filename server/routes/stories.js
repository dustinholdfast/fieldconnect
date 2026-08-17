import { nowIso } from '../clock.js';
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

const CONSENT_CHANNELS = ['newsletter', 'social', 'training', 'website'];

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function nextStage(stage) {
  const idx = STAGE_ORDER.indexOf(stage);
  if (idx === -1) return STAGE_ORDER[0];
  return STAGE_ORDER[Math.min(idx + 1, STAGE_ORDER.length - 1)];
}

function loadConsents(org, storyId) {
  return org.all(`
    SELECT id, channel, granted, granted_at, withdrawn_at
      FROM story_consents
     WHERE org_id = ? AND story_id = ?
     ORDER BY id ASC
  `, [storyId]).map((row) => ({
    id: row.id,
    channel: row.channel,
    granted: Number(row.granted) === 1,
    grantedAt: row.granted_at,
    withdrawnAt: row.withdrawn_at,
    active: Number(row.granted) === 1 && !row.withdrawn_at,
  }));
}

function canPublish(consents) {
  return consents.some((c) => c.active);
}

function mapStory(org, row) {
  const consents = loadConsents(org, row.id);
  const next = nextStage(row.stage);
  return {
    id: row.id,
    contributor: row.contributor,
    source: row.source,
    summary: row.summary,
    stage: row.stage,
    release: row.release,
    next,
    consents,
    canPublish: canPublish(consents),
    publishBlocked: next === 'Published' && row.stage !== 'Published' && !canPublish(consents),
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
    `).map((row) => mapStory(org, row));
    return { items, channels: CONSENT_CHANNELS };
  });

  app.post('/api/stories/:id/advance', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadStory(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const mapped = mapStory(org, row);
    if (mapped.publishBlocked) {
      return sendError(reply, 409, 'consent_required', {
        message: 'Cannot publish without an active channel consent.',
      });
    }
    const stage = nextStage(row.stage);
    app.db.prepare(`UPDATE stories SET stage = ? WHERE org_id = ? AND id = ?`)
      .run(stage, request.fcSession.orgId, id);
    const next = loadStory(org, id);
    return mapStory(org, next);
  });

  app.post('/api/stories/:id/consents', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadStory(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const channel = String(request.body?.channel || '').toLowerCase();
    if (!CONSENT_CHANNELS.includes(channel)) {
      return sendError(reply, 400, 'validation_failed', { fields: { channel: 'invalid' } });
    }
    const at = nowIso(app.db);
    const existing = org.get(
      `SELECT id FROM story_consents WHERE org_id = ? AND story_id = ? AND channel = ? AND withdrawn_at IS NULL`,
      [id, channel],
    );
    if (!existing) {
      org.run(
        `INSERT INTO story_consents (org_id, story_id, channel, granted, granted_at)
         VALUES (?, ?, ?, 1, ?)`,
        [id, channel, at],
      );
    }
    return mapStory(org, loadStory(org, id));
  });

  app.post('/api/stories/:id/consents/:channel/withdraw', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    const channel = String(request.params.channel || '').toLowerCase();
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const row = loadStory(org, id);
    if (!row) return sendError(reply, 404, 'not_found');
    const at = nowIso(app.db);
    app.db.prepare(`
      UPDATE story_consents
         SET withdrawn_at = ?, granted = 0
       WHERE org_id = ? AND story_id = ? AND channel = ? AND withdrawn_at IS NULL
    `).run(at, request.fcSession.orgId, id, channel);
    if (row.stage === 'Published') {
      app.db.prepare(`UPDATE stories SET stage = 'Approved' WHERE org_id = ? AND id = ?`)
        .run(request.fcSession.orgId, id);
    }
    return mapStory(org, loadStory(org, id));
  });
}
