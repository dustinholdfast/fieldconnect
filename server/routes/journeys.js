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

function mapJourney(row, steps, live) {
  const enrolled = live?.active ?? 0;
  const sent = live?.sent ?? 0;
  return {
    id: row.key,
    key: row.key,
    name: row.name,
    entry: row.entry,
    enrolled: `${enrolled} enrolled`,
    objective: row.objective,
    exit: row.exit,
    stats: [
      ['Enrolled', String(enrolled)],
      ['Messages sent', String(sent)],
      ['Exited', String(live?.exited ?? 0)],
    ],
    steps,
    engine: true,
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
  const counts = org.all(`
    SELECT journey_key,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'exited' THEN 1 ELSE 0 END) AS exited
      FROM enrollments
     WHERE org_id = ?
     GROUP BY journey_key
  `);
  const sent = org.all(`
    SELECT e.journey_key, COUNT(*) AS sent
      FROM outbound_messages m
      JOIN enrollments e ON e.id = m.enrollment_id
     WHERE m.org_id = ? AND m.status = 'sent'
     GROUP BY e.journey_key
  `);
  const live = new Map();
  for (const row of counts) live.set(row.journey_key, { active: row.active, exited: row.exited, sent: 0 });
  for (const row of sent) {
    const cur = live.get(row.journey_key) || { active: 0, exited: 0, sent: 0 };
    cur.sent = row.sent;
    live.set(row.journey_key, cur);
  }
  return rows.map((row) => mapJourney(row, byKey.get(row.key) || [], live.get(row.key)));
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
