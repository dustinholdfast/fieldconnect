import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-read-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir });
  t.after(() => app.close());
  return app;
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = list.find((c) => String(c).startsWith('fc_session='));
  assert.ok(line, 'expected fc_session Set-Cookie');
  return String(line).split(';')[0];
}

async function loginAs(app, email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, email);
  return { cookie: cookieHeader(res), csrf: res.json().csrfToken };
}

function walkJs(dir, files = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walkJs(full, files);
    else if (name.name.endsWith('.js')) files.push(full);
  }
  return files;
}

test('GET /api/journeys returns 7 seeded templates with steps', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'GET',
    url: '/api/journeys',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.items.length, 7);
  const keys = body.items.map((j) => j.id);
  assert.deepEqual(keys, ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
  for (const journey of body.items) {
    assert.ok(journey.name);
    assert.ok(journey.entry);
    assert.ok(journey.objective);
    assert.ok(journey.exit);
    assert.ok(Array.isArray(journey.stats));
    assert.ok(Array.isArray(journey.steps));
    assert.ok(journey.steps.length > 0, journey.id);
    assert.ok(journey.steps[0].timing);
    assert.ok(journey.steps[0].title);
    assert.ok(journey.steps[0].channel);
  }
});

test('FSM is 403 on nurture, stories, and recruitment reads', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  for (const url of ['/api/journeys', '/api/stories', '/api/recruitment']) {
    const res = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: fsm.cookie },
    });
    assert.equal(res.statusCode, 403, url);
    assert.deepEqual(res.json(), { error: { code: 'forbidden' } });
  }
  const story = app.db.prepare('SELECT id FROM stories ORDER BY id LIMIT 1').get();
  const advance = await app.inject({
    method: 'POST',
    url: '/api/stories/' + story.id + '/advance',
    headers: { cookie: fsm.cookie, 'x-csrf-token': fsm.csrf },
    payload: {},
  });
  assert.equal(advance.statusCode, 403);
  assert.deepEqual(advance.json(), { error: { code: 'forbidden' } });
});

test('POST /api/stories/:id/advance persists stage and clamps at Published', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const submitted = app.db.prepare("SELECT id, stage FROM stories WHERE stage = 'Submitted'").get();
  assert.ok(submitted);

  const first = await app.inject({
    method: 'POST',
    url: '/api/stories/' + submitted.id + '/advance',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().id, submitted.id);
  assert.equal(first.json().stage, 'Screened');
  assert.equal(first.json().next, 'Interview requested');
  const persisted = app.db.prepare('SELECT stage FROM stories WHERE id = ?').get(submitted.id);
  assert.equal(persisted.stage, 'Screened');

  app.db.prepare("UPDATE stories SET stage = 'Published' WHERE id = ?").run(submitted.id);
  const clamped = await app.inject({
    method: 'POST',
    url: '/api/stories/' + submitted.id + '/advance',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(clamped.statusCode, 200);
  assert.equal(clamped.json().stage, 'Published');
  assert.equal(clamped.json().next, 'Published');
  assert.equal(app.db.prepare('SELECT stage FROM stories WHERE id = ?').get(submitted.id).stage, 'Published');
});

test('GET /api/training is allowed for every role and gates are pilot_ungated', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const training = await app.inject({
    method: 'GET',
    url: '/api/training',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(training.statusCode, 200);
  const body = training.json();
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.length > 0);
  assert.ok(Array.isArray(body.modules));
  assert.equal(body.modules.length, body.items.length);
  assert.ok(body.items[0].title);
  assert.ok(body.items[0].blurb);
  assert.ok(body.items[0].durationLabel);
  assert.ok(body.tracks.includes('FSM'));
  assert.equal(body.gates.status, 'pilot_ungated');

  const gates = await app.inject({
    method: 'GET',
    url: '/api/training/gates',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(gates.statusCode, 200);
  assert.equal(gates.json().status, 'pilot_ungated');

  const byUser = await app.inject({
    method: 'GET',
    url: '/api/training/gates/' + fsm.cookie.length,
    headers: { cookie: fsm.cookie },
  });
  assert.equal(byUser.statusCode, 200);
  assert.equal(byUser.json().reason, 'pilot_ungated');
  assert.equal(byUser.json().routingEnabled, true);
});

test('GET /api/recruitment matches the fixture board for manager/admin', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'GET',
    url: '/api/recruitment',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.stats));
  assert.ok(Array.isArray(body.columns));
  assert.ok(Array.isArray(body.webinars));
  assert.equal(body.columns.length, 8);
  assert.ok(body.columns[0].candidates.length);
});

test('js/ has no from data.js imports', () => {
  const files = walkJs(join(rootDir, 'js'));
  const re = /from\s+['"]\.\.?\/data\.js['"]/;
  const hits = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (re.test(src)) hits.push(file.slice(rootDir.length + 1));
  }
  assert.deepEqual(hits, []);
});
