import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-w3-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir, jobs: false });
  t.after(() => app.close());
  return app;
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = list.find((c) => String(c).startsWith('fc_session='));
  return String(line).split(';')[0];
}

async function loginAs(app, email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, email);
  return { cookie: cookieHeader(res), csrf: res.json().csrfToken, body: res.json() };
}

test('executive logs in and is forbidden from writes', async (t) => {
  const app = await seededApp(t);
  const exec = await loginAs(app, 'exec@twincities.example', 'demo-exec-2026');
  assert.equal(exec.body.user.role, 'executive');
  assert.deepEqual(exec.body.screens, ['dashboard']);
  assert.ok(exec.body.orgs.some((o) => o.slug === 'twin-cities'));
  assert.ok(exec.body.orgs.some((o) => o.slug === 'boston'));

  const dash = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
    headers: { cookie: exec.cookie },
  });
  assert.equal(dash.statusCode, 200);

  const people = await app.inject({
    method: 'POST',
    url: '/api/people',
    headers: { cookie: exec.cookie, 'x-csrf-token': exec.csrf },
    payload: { firstName: 'Pat', lastName: 'Example', email: 'pat@example.test', source: 'Referral' },
  });
  assert.equal(people.statusCode, 403);
});

test('admin can switch org; Boston people stay empty', async (t) => {
  const app = await seededApp(t);
  const admin = await loginAs(app, 'admin@twincities.example', 'demo-admin-2026');
  assert.ok(admin.body.orgs.length >= 5);
  const boston = admin.body.orgs.find((o) => o.slug === 'boston');
  assert.ok(boston);

  const switched = await app.inject({
    method: 'POST',
    url: '/api/auth/switch-org',
    headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    payload: { orgId: boston.id },
  });
  assert.equal(switched.statusCode, 200);
  assert.equal(switched.json().org.slug, 'boston');

  const list = await app.inject({
    method: 'GET',
    url: '/api/people',
    headers: { cookie: admin.cookie },
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().items.length, 0);

  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const denied = await app.inject({
    method: 'POST',
    url: '/api/auth/switch-org',
    headers: { cookie: fsm.cookie, 'x-csrf-token': fsm.csrf },
    payload: { orgId: boston.id },
  });
  assert.equal(denied.statusCode, 404);
});

test('recruitment advance and drag persist stage', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const board = await app.inject({
    method: 'GET',
    url: '/api/recruitment',
    headers: { cookie: host.cookie },
  });
  assert.equal(board.statusCode, 200);
  const first = board.json().columns.flatMap((c) => c.candidates)[0];
  assert.ok(first?.id);
  const startStage = first.stage;

  const advanced = await app.inject({
    method: 'POST',
    url: '/api/recruitment/candidates/' + first.id + '/advance',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(advanced.statusCode, 200);
  assert.notEqual(advanced.json().stage, startStage);

  const moved = await app.inject({
    method: 'POST',
    url: '/api/recruitment/candidates/' + first.id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { stage: 'Activated' },
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.json().stage, 'Activated');
});

test('public register and book without a session', async (t) => {
  const app = await seededApp(t);
  const page = await app.inject({ method: 'GET', url: '/api/public/dn-45' });
  assert.equal(page.statusCode, 200);
  assert.equal(page.json().slug, 'dn-45');
  assert.equal(page.json().canRegister, true);

  const created = await app.inject({
    method: 'POST',
    url: '/api/public/dn-45/register',
    payload: { firstName: 'Ivy', lastName: 'Public', email: 'ivy.public@example.test', phone: '' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().person.stage, 'Registered');

  const slots = await app.inject({ method: 'GET', url: '/api/public/dn-45/slots' });
  assert.equal(slots.statusCode, 200);
  const free = slots.json().days.flatMap((d) => d.slots).find((s) => s.state === 'free');
  assert.ok(free, 'expected a free public slot');

  const booked = await app.inject({
    method: 'POST',
    url: '/api/public/dn-45-book/book',
    payload: {
      firstName: 'Ned',
      lastName: 'Booker',
      email: 'ned.booker@example.test',
      startAt: free.start,
    },
  });
  assert.equal(booked.statusCode, 201, booked.body);
  assert.equal(booked.json().appointment.status, 'Booked');
  assert.equal(booked.json().person.stage, 'Scheduled');
});

test('GET /r/dn-45 is the SPA document without auth', async (t) => {
  const app = await seededApp(t);
  const res = await app.inject({ method: 'GET', url: '/r/dn-45' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] || ''), /text\/html/);
  assert.match(res.body, /FieldConnect/);
});
