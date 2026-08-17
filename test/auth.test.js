import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';
import { ROLE_SCREENS } from '../server/rbac.js';

process.env.SEED_DEMO = 'true';

const DEMO = [
  { email: 'fsm@twincities.example', password: 'demo-fsm-2026', role: 'fsm', displayName: 'D. Whitfield' },
  { email: 'host@twincities.example', password: 'demo-host-2026', role: 'manager', displayName: 'A. Reyes' },
  { email: 'admin@twincities.example', password: 'demo-admin-2026', role: 'admin', displayName: 'M. Okafor' },
];

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-auth-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir });
  t.after(() => app.close());
  return app;
}

function cookieParts(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const line = list.find((c) => String(c).startsWith('fc_session='));
  assert.ok(line, 'expected fc_session Set-Cookie');
  const value = String(line).split(';')[0].slice('fc_session='.length);
  return { line: String(line), value, header: `fc_session=${value}` };
}

async function login(app, email, password) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
}

function assertAuthBody(body, demo) {
  assert.equal(body.user.email, demo.email);
  assert.equal(body.user.role, demo.role);
  assert.equal(body.user.displayName, demo.displayName);
  assert.equal(body.user.active, true);
  assert.equal(body.org.slug, 'twin-cities');
  assert.equal(body.org.name, 'Church of Scientology of Twin Cities');
  assert.deepEqual(body.screens, ROLE_SCREENS[demo.role]);
  assert.equal(typeof body.csrfToken, 'string');
  assert.ok(body.csrfToken.length >= 32);
}

test('login succeeds for each of the 3 demo users', async (t) => {
  const app = await seededApp(t);
  for (const demo of DEMO) {
    const res = await login(app, demo.email, demo.password);
    assert.equal(res.statusCode, 200, demo.email);
    const body = res.json();
    assertAuthBody(body, demo);
    const cookie = cookieParts(res);
    assert.match(cookie.line, /HttpOnly/i);
    assert.match(cookie.line, /SameSite=Lax/i);
    assert.match(cookie.line, /Path=\//i);
  }
});

test('bad password returns 401 invalid_credentials', async (t) => {
  const app = await seededApp(t);
  const res = await login(app, 'fsm@twincities.example', 'wrong-password');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: { code: 'invalid_credentials' } });
});

test('inactive Lindgren returns the same 401 invalid_credentials', async (t) => {
  const app = await seededApp(t);
  const res = await login(app, 'lindgren@twincities.example', 'demo-fsm-2026');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: { code: 'invalid_credentials' } });
});

test('logout revokes the session; subsequent /me is 401', async (t) => {
  const app = await seededApp(t);
  const loggedIn = await login(app, DEMO[0].email, DEMO[0].password);
  assert.equal(loggedIn.statusCode, 200);
  const { header, value } = cookieParts(loggedIn);
  assert.ok(app.db.prepare('SELECT id FROM sessions WHERE id = ?').get(value));

  const out = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: header },
  });
  assert.equal(out.statusCode, 204);
  assert.equal(app.db.prepare('SELECT id FROM sessions WHERE id = ?').get(value), undefined);

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: header },
  });
  assert.equal(me.statusCode, 401);
  assert.deepEqual(me.json(), { error: { code: 'unauthenticated' } });
});

test('mutating request without CSRF token is 403', async (t) => {
  const app = await seededApp(t);
  const loggedIn = await login(app, DEMO[0].email, DEMO[0].password);
  const { header } = cookieParts(loggedIn);
  const res = await app.inject({
    method: 'POST',
    url: '/api/ping',
    headers: { cookie: header },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: { code: 'csrf' } });
});

test('mutating request with CSRF token succeeds', async (t) => {
  const app = await seededApp(t);
  const loggedIn = await login(app, DEMO[0].email, DEMO[0].password);
  const { header } = cookieParts(loggedIn);
  const res = await app.inject({
    method: 'POST',
    url: '/api/ping',
    headers: { cookie: header, 'x-csrf-token': loggedIn.json().csrfToken },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
});

test('sixth login failure is 429 rate_limited', async (t) => {
  const app = await seededApp(t);
  const email = `brute-${Date.now()}@twincities.example`;
  for (let i = 0; i < 5; i += 1) {
    const res = await login(app, email, 'nope');
    assert.equal(res.statusCode, 401, `failure ${i + 1}`);
  }
  const limited = await login(app, email, 'nope');
  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.json(), { error: { code: 'rate_limited' } });
});

test('/me slides expires_at', async (t) => {
  const app = await seededApp(t);
  const loggedIn = await login(app, DEMO[1].email, DEMO[1].password);
  const { header, value } = cookieParts(loggedIn);
  const before = app.db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(value);
  assert.ok(before);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: header },
  });
  assert.equal(me.statusCode, 200);
  assertAuthBody(me.json(), DEMO[1]);
  const after = app.db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(value);
  assert.ok(Date.parse(after.expires_at) > Date.parse(before.expires_at));
});

test('cookie has no Secure when NODE_ENV=development', async (t) => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  t.after(() => {
    if (prev === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  });
  const app = await seededApp(t);
  const res = await login(app, DEMO[2].email, DEMO[2].password);
  assert.equal(res.statusCode, 200);
  const { line } = cookieParts(res);
  assert.doesNotMatch(line, /;\s*Secure/i);
});

test('unauthenticated /api/* is 401; /metrics is admin-only', async (t) => {
  const app = await seededApp(t);
  const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
  assert.equal(me.statusCode, 401);
  assert.deepEqual(me.json(), { error: { code: 'unauthenticated' } });

  const metrics = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(metrics.statusCode, 401);

  const fsm = await login(app, DEMO[0].email, DEMO[0].password);
  const fsmMetrics = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { cookie: cookieParts(fsm).header },
  });
  assert.equal(fsmMetrics.statusCode, 403);
  assert.deepEqual(fsmMetrics.json(), { error: { code: 'forbidden' } });

  const admin = await login(app, DEMO[2].email, DEMO[2].password);
  const adminMetrics = await app.inject({
    method: 'GET',
    url: '/metrics',
    headers: { cookie: cookieParts(admin).header },
  });
  assert.equal(adminMetrics.statusCode, 200);
  assert.equal(typeof adminMetrics.json().http_requests, 'number');
});
