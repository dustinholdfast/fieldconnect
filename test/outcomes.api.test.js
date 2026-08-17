import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-out-'));
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

function appointmentByPerson(app, name) {
  return app.db.prepare(`
    SELECT a.* FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = ?
     ORDER BY a.id ASC
  `).get(name);
}

function product(app, sku) {
  return app.db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
}

function postOutcome(app, session, payload, headerKey) {
  return app.inject({
    method: 'POST',
    url: '/api/outcomes',
    headers: {
      cookie: session.cookie,
      'x-csrf-token': session.csrf,
      'idempotency-key': headerKey === undefined ? payload.clientId : headerKey,
    },
    payload,
  });
}

test('GET /api/catalog and /api/pathways return approved priced rows', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const cat = await app.inject({
    method: 'GET',
    url: '/api/catalog',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(cat.statusCode, 200);
  const skus = cat.json().items.map((i) => i.sku);
  assert.ok(skus.includes('dn-book'));
  assert.ok(skus.includes('dn-seminar'));
  const book = cat.json().items.find((i) => i.sku === 'dn-book');
  assert.equal(book.listPriceCents, 2500);

  const paths = await app.inject({
    method: 'GET',
    url: '/api/pathways',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(paths.statusCode, 200);
  assert.equal(paths.json().status, 'approved');
  assert.ok(paths.json().items.some((i) => i.ruinCategory === 'Stress & anxiety'));
});

test('Partial then Completed is 201 not 409; Partial writes no outcomes row', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = appointmentByPerson(app, 'Karen Iversen');
  const person = personByName(app, 'Karen Iversen');
  const stageBefore = person.stage;
  const journeyBefore = person.journey_key;

  const partial = await postOutcome(app, fsm, {
    clientId: 'partial-karen-1',
    appointmentId: appt.id,
    delivered: 'partial',
    durationMin: 18,
    partialReason: 'had to pick up a child',
    channel: 'Email',
  });
  assert.equal(partial.statusCode, 201, partial.body);
  assert.equal(partial.json().appointment.status, 'Partial');
  assert.equal(partial.json().outcome, null);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM outcomes WHERE appointment_id = ?').get(appt.id).c,
    0,
  );
  const afterPartial = app.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appt.id);
  assert.equal(afterPartial.status, 'Partial');
  assert.equal(afterPartial.actual_duration_min, 18);
  assert.equal(afterPartial.partial_reason, 'had to pick up a child');
  const personPartial = personByName(app, 'Karen Iversen');
  assert.equal(personPartial.stage, stageBefore);
  assert.equal(personPartial.journey_key, journeyBefore);

  const book = product(app, 'dn-book');
  const done = await postOutcome(app, fsm, {
    clientId: 'complete-karen-1',
    appointmentId: appt.id,
    delivered: 'yes',
    durationMin: 46,
    result: 'Qualified',
    channel: 'Email',
    ruinCategory: 'Stress & anxiety',
    pathwayLabel: 'Dianetics book',
    lineItems: [{ productId: book.id, qty: 1, unitPriceCents: 2500 }],
    consents: { followup: true, testimonial: false, publicStory: false },
  });
  assert.equal(done.statusCode, 201, done.body);
  assert.notEqual(done.statusCode, 409);
  assert.equal(done.json().appointment.status, 'Completed');
  assert.equal(done.json().outcome.derivedStatus, 'Completed');
  assert.equal(done.json().outcome.journeyKey, 'j4');
  assert.equal(done.json().outcome.revenueCents, 2500);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM outcomes WHERE appointment_id = ?').get(appt.id).c,
    1,
  );
  const personDone = personByName(app, 'Karen Iversen');
  assert.equal(personDone.stage, 'Completed');
  assert.equal(personDone.journey_key, 'j4');
});

test('replay of the same clientId returns 200', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = appointmentByPerson(app, 'Anita Sørensen');
  const payload = {
    clientId: 'replay-anita-1',
    appointmentId: appt.id,
    delivered: 'no',
    channel: 'Email',
  };
  const first = await postOutcome(app, fsm, payload);
  assert.equal(first.statusCode, 201, first.body);
  const replay = await postOutcome(app, fsm, payload);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json().outcome.id, first.json().outcome.id);
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM outcomes WHERE appointment_id = ?').get(appt.id).c,
    1,
  );
});

test('Idempotency-Key mismatch is 400', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = appointmentByPerson(app, 'N. Brooks');
  const res = await postOutcome(app, fsm, {
    clientId: 'body-key',
    appointmentId: appt.id,
    delivered: 'no',
    channel: 'Email',
  }, 'header-key');
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'idempotency_mismatch');
});

test('delivered=no does not require a pathway and maps stage to No-show / j2', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = appointmentByPerson(app, 'N. Brooks');
  const res = await postOutcome(app, fsm, {
    clientId: 'noshow-brooks-1',
    appointmentId: appt.id,
    delivered: 'no',
    channel: 'Phone',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().appointment.status, 'No-show');
  assert.equal(res.json().outcome.derivedStatus, 'No-show');
  assert.equal(res.json().outcome.journeyKey, 'j2');
  const row = app.db.prepare('SELECT * FROM outcomes WHERE appointment_id = ?').get(appt.id);
  assert.equal(row.delivered, 'no');
  assert.equal(row.result, 'No-show');
  assert.equal(row.pathway_label, null);
  const person = personByName(app, 'N. Brooks');
  assert.equal(person.stage, 'No-show');
  assert.equal(person.journey_key, 'j2');
});

test('manager and admin POST /api/outcomes are 403', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const admin = await loginAs(app, 'admin@twincities.example', 'demo-admin-2026');
  const appt = appointmentByPerson(app, 'Karen Iversen');
  for (const session of [host, admin]) {
    const res = await postOutcome(app, session, {
      clientId: 'manager-block-' + session.csrf.slice(0, 8),
      appointmentId: appt.id,
      delivered: 'no',
      channel: 'Email',
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error.code, 'forbidden');
  }
});

test('different clientId on an appointment that already has an outcomes row is 409', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = appointmentByPerson(app, 'Anita Sørensen');
  const first = await postOutcome(app, fsm, {
    clientId: 'conflict-a',
    appointmentId: appt.id,
    delivered: 'yes',
    durationMin: 40,
    result: 'Follow-up required',
    channel: 'Email',
  });
  assert.equal(first.statusCode, 201, first.body);
  const second = await postOutcome(app, fsm, {
    clientId: 'conflict-b',
    appointmentId: appt.id,
    delivered: 'yes',
    durationMin: 40,
    result: 'Qualified',
    channel: 'Email',
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'conflict');
});

test('FSM cannot submit another FSM’s appointment', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const elena = appointmentByPerson(app, 'Elena Duarte');
  const res = await postOutcome(app, fsm, {
    clientId: 'not-own-elena',
    appointmentId: elena.id,
    delivered: 'no',
    channel: 'Email',
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'not_found');
});

test('yes + Not a fit maps stage and writes j6; GET outcome is FSM-own', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const appt = appointmentByPerson(app, 'Karen Iversen');
  const res = await postOutcome(app, fsm, {
    clientId: 'not-a-fit-karen',
    appointmentId: appt.id,
    delivered: 'yes',
    durationMin: 30,
    result: 'Not a fit',
    channel: 'Email',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().outcome.journeyKey, 'j6');
  assert.equal(personByName(app, 'Karen Iversen').stage, 'Not a fit');

  const id = res.json().outcome.id;
  const got = await app.inject({
    method: 'GET',
    url: '/api/outcomes/' + id,
    headers: { cookie: fsm.cookie },
  });
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().journeyKey, 'j6');

  const asHost = await app.inject({
    method: 'GET',
    url: '/api/outcomes/' + id,
    headers: { cookie: host.cookie },
  });
  assert.equal(asHost.statusCode, 403);
});
