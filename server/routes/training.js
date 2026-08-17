import { nowIso } from '../clock.js';
import { withOrg } from '../db.js';
import { routingGate } from '../training/gates.js';

const TRACK_ORDER = [
  'Host',
  'FSM',
  'Qual handling',
  'Campaign manager',
  'Disseminator',
  'Recruiter',
  'Success line',
];

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function progressFor(db, orgId, userId, moduleId) {
  if (userId == null) return { progressPct: 0, status: 'not_started' };
  const row = db.prepare(`
    SELECT progress_pct, status FROM training_progress
     WHERE org_id = ? AND user_id = ? AND module_id = ?
  `).get(orgId, userId, moduleId);
  if (!row) return { progressPct: 0, status: 'not_started' };
  return { progressPct: Number(row.progress_pct) || 0, status: row.status };
}

function toneFor(status, pct) {
  if (status === 'complete' || pct >= 100) return 'ok';
  if (status === 'in_progress' || pct > 0) return 'warn';
  return 'bad';
}

function mapModule(db, orgId, userId, row) {
  const prog = progressFor(db, orgId, userId, row.id);
  return {
    id: row.id,
    track: row.track,
    title: row.title,
    blurb: row.blurb,
    durationLabel: row.duration_label,
    sortOrder: row.sort_order,
    progressPct: prog.progressPct,
    status: prog.status === 'complete' ? 'Complete' : prog.status === 'in_progress' ? 'In progress' : 'Not started',
    tone: toneFor(prog.status, prog.progressPct),
  };
}

function loadModules(db, orgId, userId) {
  const rows = db.prepare(`
    SELECT id, track, title, blurb, duration_label, sort_order
      FROM training_modules
     WHERE org_id = ?
     ORDER BY sort_order ASC, id ASC
  `).all(orgId);
  return rows.map((row) => mapModule(db, orgId, userId, row));
}

function orderedTracks(modules) {
  const present = new Set(modules.map((m) => m.track));
  const ordered = TRACK_ORDER.filter((t) => present.has(t));
  for (const t of present) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  return ordered;
}

function gatesFor(db, orgId, userId) {
  const gate = routingGate(db, orgId, userId);
  return {
    status: gate.routingEnabled ? 'ready' : gate.reason,
    routingEnabled: gate.routingEnabled,
    reason: gate.reason,
    complete: gate.complete,
    required: gate.required,
    signedOff: gate.signedOff,
  };
}

export async function registerTrainingRoutes(app) {
  app.get('/api/training', async (request) => {
    const session = request.fcSession;
    const items = loadModules(app.db, session.orgId, session.userId);
    let fsms = [];
    if (session.role === 'manager' || session.role === 'admin') {
      fsms = app.db.prepare(`
        SELECT id, display_name FROM users WHERE org_id = ? AND role = 'fsm' ORDER BY id
      `).all(session.orgId).map((u) => ({
        id: u.id,
        name: u.display_name,
        ...gatesFor(app.db, session.orgId, u.id),
      }));
    }
    return { tracks: orderedTracks(items), items, modules: items, gates: gatesFor(app.db, session.orgId, session.userId), fsms };
  });

  app.get('/api/training/modules', async (request) => {
    const session = request.fcSession;
    const items = loadModules(app.db, session.orgId, session.userId);
    const track = request.query?.track;
    return { items: track ? items.filter((m) => m.track === track) : items };
  });

  app.get('/api/training/tracks', async (request) => {
    const items = loadModules(app.db, request.fcSession.orgId, request.fcSession.userId);
    return { items: orderedTracks(items) };
  });

  app.get('/api/training/courses', async (request) => {
    const items = loadModules(app.db, request.fcSession.orgId, request.fcSession.userId);
    const track = request.query?.track;
    return { items: track ? items.filter((m) => m.track === track) : items };
  });

  app.get('/api/training/courses/:id', async (request, reply) => {
    const session = request.fcSession;
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const item = loadModules(app.db, session.orgId, session.userId).find((m) => m.id === id);
    if (!item) return sendError(reply, 404, 'not_found');
    return item;
  });

  app.get('/api/training/gates', async (request) => {
    return gatesFor(app.db, request.fcSession.orgId, request.fcSession.userId);
  });

  app.get('/api/training/gates/:userId', async (request, reply) => {
    const session = request.fcSession;
    const userId = Number(request.params.userId);
    if (!Number.isInteger(userId)) return sendError(reply, 404, 'not_found');
    if (session.role === 'fsm' && userId !== session.userId) return sendError(reply, 404, 'not_found');
    return gatesFor(app.db, session.orgId, userId);
  });

  app.post('/api/training/progress', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const moduleId = Number(request.body?.moduleId);
    const pct = Math.max(0, Math.min(100, Number(request.body?.progressPct ?? 100)));
    if (!Number.isInteger(moduleId)) {
      return sendError(reply, 400, 'validation_failed', { fields: { moduleId: 'required' } });
    }
    const mod = org.get(`SELECT id FROM training_modules WHERE org_id = ? AND id = ?`, [moduleId]);
    if (!mod) return sendError(reply, 404, 'not_found');
    const status = pct >= 100 ? 'complete' : pct > 0 ? 'in_progress' : 'not_started';
    const at = nowIso(app.db);
    app.db.prepare(`
      INSERT INTO training_progress (org_id, user_id, module_id, progress_pct, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, module_id) DO UPDATE SET
        progress_pct = excluded.progress_pct,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(session.orgId, session.userId, moduleId, pct, status, at);
    return mapModule(app.db, session.orgId, session.userId, org.get(
      `SELECT id, track, title, blurb, duration_label, sort_order FROM training_modules WHERE org_id = ? AND id = ?`,
      [moduleId],
    ));
  });

  app.post('/api/training/signoff', async (request, reply) => {
    const session = request.fcSession;
    if (session.role !== 'manager' && session.role !== 'admin') {
      return sendError(reply, 403, 'forbidden');
    }
    const userId = Number(request.body?.userId);
    const track = String(request.body?.track || 'FSM');
    if (!Number.isInteger(userId)) {
      return sendError(reply, 400, 'validation_failed', { fields: { userId: 'required' } });
    }
    const user = app.db.prepare(`SELECT id FROM users WHERE org_id = ? AND id = ?`).get(session.orgId, userId);
    if (!user) return sendError(reply, 404, 'not_found');
    const at = nowIso(app.db);
    const existing = app.db.prepare(`
      SELECT id FROM signoffs WHERE org_id = ? AND user_id = ? AND track = ?
    `).get(session.orgId, userId, track);
    if (!existing) {
      app.db.prepare(`
        INSERT INTO signoffs (org_id, user_id, track, supervisor_id, signed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(session.orgId, userId, track, session.userId, at);
    }
    return gatesFor(app.db, session.orgId, userId);
  });
}
