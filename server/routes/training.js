import { withOrg } from '../db.js';

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

// Wave 2 flips this. Pilot never withholds appointment routing.
function gatesBody() {
  return { status: 'pilot_ungated', routingEnabled: true, reason: 'pilot_ungated' };
}

function mapModule(row) {
  return {
    id: row.id,
    track: row.track,
    title: row.title,
    blurb: row.blurb,
    durationLabel: row.duration_label,
    sortOrder: row.sort_order,
    progressPct: 0,
    status: 'Available',
    tone: 'inherit',
  };
}

function loadModules(org) {
  return org.all(`
    SELECT id, track, title, blurb, duration_label, sort_order
      FROM training_modules
     WHERE org_id = ?
     ORDER BY sort_order ASC, id ASC
  `).map(mapModule);
}

function orderedTracks(modules) {
  const present = new Set(modules.map((m) => m.track));
  const ordered = TRACK_ORDER.filter((t) => present.has(t));
  for (const t of present) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  return ordered;
}

function filterTrack(modules, track) {
  if (!track) return modules;
  return modules.filter((m) => m.track === track);
}

export async function registerTrainingRoutes(app) {
  app.get('/api/training', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = loadModules(org);
    return { tracks: orderedTracks(items), items, modules: items, gates: gatesBody() };
  });

  app.get('/api/training/modules', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = filterTrack(loadModules(org), request.query?.track);
    return { items };
  });

  app.get('/api/training/tracks', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    return { items: orderedTracks(loadModules(org)) };
  });

  app.get('/api/training/courses', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const items = filterTrack(loadModules(org), request.query?.track);
    return { items };
  });

  app.get('/api/training/courses/:id', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return sendError(reply, 404, 'not_found');
    const item = loadModules(org).find((m) => m.id === id);
    if (!item) return sendError(reply, 404, 'not_found');
    return item;
  });

  app.get('/api/training/gates', async () => gatesBody());

  app.get('/api/training/gates/:userId', async () => gatesBody());
}
