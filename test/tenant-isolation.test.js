import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_CLOCK } from '../server/fixtures/demo.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-tenant-'));
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

function insertBostonPerson(app) {
  const boston = app.db.prepare("SELECT id FROM organizations WHERE slug = 'boston'").get();
  assert.ok(boston);
  const info = app.db.prepare(`
    INSERT INTO people (
      org_id, first_name, last_name, display_name, email, stage, created_at, updated_at
    ) VALUES (?, 'Boston', 'Ghost', 'Boston Ghost', 'boston.ghost@example.test', 'Registered', ?, ?)
  `).run(boston.id, DEMO_CLOCK, DEMO_CLOCK);
  return { bostonId: boston.id, personId: Number(info.lastInsertRowid) };
}

test('Boston person is 404 from a Twin Cities session', async (t) => {
  const app = await seededApp(t);
  const { personId } = insertBostonPerson(app);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');

  for (const session of [host, fsm]) {
    const one = await app.inject({
      method: 'GET',
      url: '/api/people/' + personId,
      headers: { cookie: session.cookie },
    });
    assert.equal(one.statusCode, 404);
    assert.deepEqual(one.json(), { error: { code: 'not_found' } });

    const list = await app.inject({
      method: 'GET',
      url: '/api/people?q=Boston+Ghost',
      headers: { cookie: session.cookie },
    });
    assert.equal(list.statusCode, 200);
    assert.ok(!list.json().items.some((item) => item.id === personId));

    const engagements = await app.inject({
      method: 'GET',
      url: '/api/people/' + personId + '/engagements',
      headers: { cookie: session.cookie },
    });
    assert.equal(engagements.statusCode, 404);
  }

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/people/' + personId,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { firstName: 'Nope' },
  });
  assert.equal(patched.statusCode, 404);

  const link = await app.inject({
    method: 'POST',
    url: '/api/people/' + personId + '/send-link',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(link.statusCode, 404);
});

test('body org_id is ignored; create stays on the session org', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const boston = app.db.prepare("SELECT id FROM organizations WHERE slug = 'boston'").get();
  const twin = app.db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get();
  const res = await app.inject({
    method: 'POST',
    url: '/api/people',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {
      firstName: 'Session',
      lastName: 'Bound',
      email: 'session.bound@example.test',
      source: 'Other',
      org_id: boston.id,
      orgId: boston.id,
    },
  });
  assert.equal(res.statusCode, 201);
  const row = app.db.prepare('SELECT org_id, email FROM people WHERE id = ?').get(res.json().id);
  assert.equal(row.org_id, twin.id);
  assert.equal(row.email, 'session.bound@example.test');
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM people WHERE org_id = ? AND email = ?')
      .get(boston.id, 'session.bound@example.test').c,
    0,
  );
});
