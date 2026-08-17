import { withOrg } from '../db.js';

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function parseStats(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return Object.entries(parsed);
  } catch { /* seed writes object JSON */ }
  return [];
}

function mapStep(row) {
  return {
    timing: row.timing,
    title: row.title,
    body: row.body,
    channel: row.channel,
    engagement: row.engagement,
  };
}

function mapJourney(row, steps) {
  return {
    id: row.key,
    key: row.key,
    name: row.name,
    entry: row.entry,
    enrolled: row.enrolled,
    objective: row.objective,
    exit: row.exit,
    stats: parseStats(row.stats_json),
    steps,
  };
}

function loadJourneys(org) {
  const rows = org.all(`
    SELECT key, name, entry, enrolled, objective, exit, stats_json
      FROM journeys
     WHERE org_id = ?
     ORDER BY key ASC
  `);
  const steps = org.all(`
    SELECT s.journey_key, s.sort_order, s.timing, s.title, s.body, s.channel, s.engagement
      FROM journey_steps s
      JOIN journeys j ON j.key = s.journey_key
     WHERE j.org_id = ?
     ORDER BY s.journey_key ASC, s.sort_order ASC
  `);
  const byKey = new Map();
  for (const row of rows) byKey.set(row.key, []);
  for (const step of steps) {
    const list = byKey.get(step.journey_key);
    if (list) list.push(mapStep(step));
  }
  return rows.map((row) => mapJourney(row, byKey.get(row.key) || []));
}

export async function registerJourneyRoutes(app) {
  app.get('/api/journeys', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    return { items: loadJourneys(org) };
  });

  app.get('/api/journeys/:id', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const key = String(request.params.id || '');
    const item = loadJourneys(org).find((j) => j.id === key);
    if (!item) return sendError(reply, 404, 'not_found');
    return item;
  });
}
