import { nowIso } from '../clock.js';
import { withOrg } from '../db.js';

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function parseTokens(raw) {
  if (!raw) return { busy: [] };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { busy: [] };
  } catch {
    return { busy: [] };
  }
}

function mapConn(row) {
  const tokens = parseTokens(row.tokens_encrypted);
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    lastSyncAt: row.last_sync_at,
    busy: tokens.busy || [],
  };
}

export function loadBusyWindows(db, orgId, userId) {
  if (userId == null) return [];
  const rows = db.prepare(`
    SELECT tokens_encrypted FROM calendar_connections
     WHERE org_id = ? AND user_id = ? AND status = 'connected'
  `).all(orgId, userId);
  const busy = [];
  for (const row of rows) {
    for (const block of parseTokens(row.tokens_encrypted).busy || []) {
      const start = Date.parse(block.start);
      const end = Date.parse(block.end);
      if (Number.isFinite(start) && Number.isFinite(end)) busy.push({ start, end });
    }
  }
  return busy;
}

export async function registerCalendarRoutes(app) {
  app.get('/api/calendar/connections', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = org.all(`
      SELECT id, provider, status, last_sync_at, tokens_encrypted
        FROM calendar_connections
       WHERE org_id = ? AND user_id = ?
       ORDER BY id ASC
    `, [request.fcSession.userId]).map(mapConn);
    return { items };
  });

  app.post('/api/calendar/connections', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const provider = String(request.body?.provider || '').toLowerCase();
    if (provider !== 'google' && provider !== 'outlook') {
      return sendError(reply, 400, 'validation_failed', { fields: { provider: 'google or outlook' } });
    }
    const existing = org.get(
      `SELECT id FROM calendar_connections WHERE org_id = ? AND user_id = ? AND provider = ?`,
      [session.userId, provider],
    );
    const at = nowIso(app.db);
    const busy = [{
      start: '2026-08-28T15:00:00-05:00',
      end: '2026-08-28T16:00:00-05:00',
    }];
    const payload = JSON.stringify({ demo: true, busy });
    if (existing) {
      app.db.prepare(`
        UPDATE calendar_connections
           SET status = 'connected', tokens_encrypted = ?, last_sync_at = ?
         WHERE org_id = ? AND id = ?
      `).run(payload, at, session.orgId, existing.id);
      const row = org.get(`SELECT * FROM calendar_connections WHERE org_id = ? AND id = ?`, [existing.id]);
      return mapConn(row);
    }
    const info = org.run(
      `INSERT INTO calendar_connections (
         org_id, user_id, provider, status, tokens_encrypted, last_sync_at
       ) VALUES (?, ?, ?, 'connected', ?, ?)`,
      [session.userId, provider, payload, at],
    );
    const row = org.get(`SELECT * FROM calendar_connections WHERE org_id = ? AND id = ?`, [Number(info.lastInsertRowid)]);
    return reply.code(201).send(mapConn(row));
  });

  app.delete('/api/calendar/connections/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    const row = org.get(
      `SELECT id FROM calendar_connections WHERE org_id = ? AND id = ? AND user_id = ?`,
      [id, session.userId],
    );
    if (!row) return sendError(reply, 404, 'not_found');
    app.db.prepare(`
      UPDATE calendar_connections SET status = 'disconnected', last_sync_at = ?
       WHERE org_id = ? AND id = ?
    `).run(nowIso(app.db), session.orgId, id);
    return { id, status: 'disconnected' };
  });
}
