import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { now } from '../server/clock.js';
import { DEMO_CLOCK } from '../server/fixtures/demo.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-attn-'));
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

function personByName(app, name) {
  return app.db.prepare('SELECT * FROM people WHERE display_name = ?').get(name);
}

function userByEmail(app, email) {
  return app.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function twinId(app) {
  return app.db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get().id;
}

function setClock(app, iso) {
  app.db.prepare("UPDATE app_meta SET value = ? WHERE key = 'demo_clock'").run(iso);
}

function byCode(items, code) {
  return (items || []).find((item) => item.code === code);
}

test('seed yields unconfirmed_24h (Anita) and outcome_overdue (N. Brooks)', async (t) => {
  const app = await seededApp(t);
  assert.equal(now(app.db).toISOString(), new Date(DEMO_CLOCK).toISOString());

  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const items = res.json().items;
  const unconfirmed = byCode(items, 'unconfirmed_24h');
  const overdue = byCode(items, 'outcome_overdue');
  assert.ok(unconfirmed, 'unconfirmed_24h present');
  assert.equal(unconfirmed.count, 1);
  assert.equal(unconfirmed.href, '/scheduling?filter=unconfirmed');
  assert.equal(unconfirmed.label, 'Appointments unconfirmed within 24 h');
  assert.ok(overdue, 'outcome_overdue present');
  assert.equal(overdue.count, 1);
  assert.equal(overdue.href, '/scheduling?filter=outcome_overdue');

  const anita = personByName(app, 'Anita Sørensen');
  const brooks = personByName(app, 'N. Brooks');
  const listedUnconfirmed = await app.inject({
    method: 'GET',
    url: '/api/appointments?filter=unconfirmed',
    headers: { cookie: host.cookie },
  });
  assert.equal(listedUnconfirmed.statusCode, 200);
  const unconfirmedPeople = listedUnconfirmed.json().items.map((a) => a.personId);
  assert.deepEqual(unconfirmedPeople, [anita.id]);

  const listedOverdue = await app.inject({
    method: 'GET',
    url: '/api/appointments?filter=outcome_overdue',
    headers: { cookie: host.cookie },
  });
  assert.equal(listedOverdue.statusCode, 200);
  const overduePeople = listedOverdue.json().items.map((a) => a.personId);
  assert.deepEqual(overduePeople, [brooks.id]);
});

test('FSM attention links only open own rows', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const whitfield = userByEmail(app, 'fsm@twincities.example');
  const lindgren = userByEmail(app, 'lindgren@twincities.example');
  const ada = personByName(app, 'Ada Pencilton');
  const orgId = twinId(app);

  app.db.prepare(`
    INSERT INTO appointments (
      org_id, person_id, fsm_user_id, start_at, timezone, duration_min, status, created_at
    ) VALUES
      (?, ?, ?, '2026-08-27T16:00:00-05:00', 'America/Chicago', 45, 'Booked', ?),
      (?, ?, ?, '2026-08-24T11:00:00-05:00', 'America/Chicago', 45, 'Confirmed', ?)
  `).run(orgId, ada.id, lindgren.id, DEMO_CLOCK, orgId, ada.id, lindgren.id, DEMO_CLOCK);

  const manager = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  assert.equal(manager.statusCode, 200);
  assert.equal(byCode(manager.json().items, 'unconfirmed_24h').count, 2);
  assert.equal(byCode(manager.json().items, 'outcome_overdue').count, 2);

  const own = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(own.statusCode, 200);
  assert.equal(byCode(own.json().items, 'unconfirmed_24h').count, 1);
  assert.equal(byCode(own.json().items, 'outcome_overdue').count, 1);

  for (const filter of ['unconfirmed', 'outcome_overdue']) {
    const list = await app.inject({
      method: 'GET',
      url: '/api/appointments?filter=' + filter,
      headers: { cookie: fsm.cookie },
    });
    assert.equal(list.statusCode, 200, filter);
    const items = list.json().items;
    assert.ok(items.length >= 1, filter);
    assert.ok(items.every((a) => a.fsmUserId === whitfield.id), filter);
    assert.ok(items.every((a) => a.personName !== 'Ada Pencilton'), filter);
  }
});

test('all attention predicates use clock.now() (demo clock)', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = personByName(app, 'Karen Iversen');
  const ada = personByName(app, 'Ada Pencilton');
  const whitfield = userByEmail(app, 'fsm@twincities.example');
  const orgId = twinId(app);

  app.db.prepare(`
    INSERT INTO assignments (org_id, person_id, user_id, kind, status, due_at, created_at)
    VALUES (?, ?, ?, 'follow_up', 'open', '2026-08-26T09:00:00-05:00', ?)
  `).run(orgId, karen.id, whitfield.id, DEMO_CLOCK);
  app.db.prepare(`
    UPDATE people SET lawful_basis = NULL, suppressed = 0 WHERE org_id = ? AND id = ?
  `).run(orgId, ada.id);

  const atDemo = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  assert.equal(atDemo.statusCode, 200);
  const demoItems = atDemo.json().items;
  assert.equal(byCode(demoItems, 'unconfirmed_24h')?.count, 1);
  assert.equal(byCode(demoItems, 'outcome_overdue')?.count, 1);
  assert.equal(byCode(demoItems, 'followup_overdue')?.count, 1);
  assert.equal(byCode(demoItems, 'no_lawful_basis')?.count, 1);
  assert.equal(byCode(demoItems, 'followup_overdue').href, '/crm?filter=followup_overdue');
  assert.equal(byCode(demoItems, 'no_lawful_basis').href, '/crm?filter=no_lawful_basis');

  // Wall clock on review day (2026-08-17) would miss every time-based fixture.
  setClock(app, '2026-08-17T12:00:00-05:00');
  assert.equal(now(app.db).toISOString(), new Date('2026-08-17T12:00:00-05:00').toISOString());
  const atWall = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  const wallItems = atWall.json().items;
  assert.equal(byCode(wallItems, 'unconfirmed_24h'), undefined);
  assert.equal(byCode(wallItems, 'outcome_overdue'), undefined);
  assert.equal(byCode(wallItems, 'followup_overdue'), undefined);
  assert.equal(byCode(wallItems, 'no_lawful_basis')?.count, 1);

  setClock(app, '2026-08-27T21:00:00-05:00');
  const afterAnita = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  const later = afterAnita.json().items;
  assert.equal(byCode(later, 'unconfirmed_24h'), undefined);
  assert.equal(byCode(later, 'outcome_overdue')?.count, 1);
  assert.equal(byCode(later, 'followup_overdue')?.count, 1);
});

test('GET /api/dashboard is live seed counts, three FSM rows, no prototype copy', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');

  const unauth = await app.inject({ method: 'GET', url: '/api/dashboard' });
  assert.equal(unauth.statusCode, 401);

  const res = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const blob = JSON.stringify(body);
  assert.equal(blob.includes('1840'), false);
  assert.equal(blob.includes('Marchetti'), false);
  assert.equal(blob.includes('Nakamura'), false);

  const people = app.db.prepare(
    'SELECT COUNT(*) AS c FROM people WHERE org_id = ? AND merged_into_id IS NULL',
  ).get(twinId(app)).c;
  const registered = body.kpis.find((k) => k.key === 'registered');
  assert.equal(registered.value, people);
  assert.ok(registered.value < 200, 'seed is small; not prototype 412');

  assert.deepEqual(body.kpis.map((k) => k.key), [
    'registered', 'attended', 'interested', 'completed', 'books', 'seminars',
  ]);
  assert.deepEqual(body.funnel.map((f) => f.key), [
    'invited', 'registered', 'attended', 'interested', 'booked', 'completed', 'book_sold', 'seminar_sold',
  ]);

  assert.equal(body.byFsm.length, 3);
  assert.deepEqual(body.byFsm.map((r) => r.name), ['D. Whitfield', 'S. Lindgren', 'J. Okonjo']);
  const lindgren = body.byFsm.find((r) => r.name === 'S. Lindgren');
  assert.equal(lindgren.done, 2);
  const whitfield = body.byFsm.find((r) => r.name === 'D. Whitfield');
  assert.equal(whitfield.noShow, 1);

  const boston = app.db.prepare("SELECT id FROM organizations WHERE slug = 'boston'").get();
  app.db.prepare(`
    INSERT INTO people (org_id, first_name, last_name, display_name, email, stage, created_at, updated_at)
    VALUES (?, 'Boston', 'Ghost', 'Boston Ghost', 'boston.ghost@example.test', 'Registered', ?, ?)
  `).run(boston.id, DEMO_CLOCK, DEMO_CLOCK);
  const after = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
    headers: { cookie: host.cookie },
  });
  assert.equal(after.json().kpis.find((k) => k.key === 'registered').value, people);

  const fsmDash = await app.inject({
    method: 'GET',
    url: '/api/dashboard',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(fsmDash.statusCode, 200);
  const fsmRegistered = fsmDash.json().kpis.find((k) => k.key === 'registered').value;
  assert.ok(fsmRegistered < people, 'FSM KPIs are assignment-scoped');
  assert.equal(fsmDash.json().byFsm.length, 3);
});

test('empty attention inbox omits zero counts', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  setClock(app, '2026-08-17T12:00:00-05:00');
  const res = await app.inject({
    method: 'GET',
    url: '/api/attention',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().items, []);
});
