import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_CLOCK } from '../server/fixtures/demo.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-people-'));
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

function twinId(app) {
  return app.db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get().id;
}

async function createPerson(app, session, payload) {
  return app.inject({
    method: 'POST',
    url: '/api/people',
    headers: { cookie: session.cookie, 'x-csrf-token': session.csrf },
    payload,
  });
}

test('search matrix matches name, email, and phone digits', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = personByName(app, 'Karen Iversen');
  assert.ok(karen);
  for (const q of ['Karen', 'Iversen', 'k.iversen@mail.com', '6125550148', '612-555-0148']) {
    const res = await app.inject({
      method: 'GET',
      url: '/api/people?q=' + encodeURIComponent(q),
      headers: { cookie: host.cookie },
    });
    assert.equal(res.statusCode, 200, q);
    const body = res.json();
    assert.ok(body.items.some((item) => item.id === karen.id), q);
    const hit = body.items.find((item) => item.id === karen.id);
    assert.equal(hit.displayName, 'Karen Iversen');
    assert.equal(hit.email, 'k.iversen@mail.com');
    assert.equal(hit.stage, 'Scheduled');
    assert.equal(typeof hit.consent, 'string');
    assert.equal(typeof hit.suppressed, 'boolean');
  }
});

test('FSM 404 on unassigned person and list excludes them', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const priya = personByName(app, 'Priya Raman');
  const karen = personByName(app, 'Karen Iversen');
  const missing = await app.inject({
    method: 'GET',
    url: '/api/people/' + priya.id,
    headers: { cookie: fsm.cookie },
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: { code: 'not_found' } });

  const listed = await app.inject({
    method: 'GET',
    url: '/api/people',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(listed.statusCode, 200);
  const ids = listed.json().items.map((item) => item.id);
  assert.ok(!ids.includes(priya.id));
  assert.ok(ids.includes(karen.id));

  const own = await app.inject({
    method: 'GET',
    url: '/api/people/' + karen.id,
    headers: { cookie: fsm.cookie },
  });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().displayName, 'Karen Iversen');
  assert.ok(Array.isArray(own.json().history));
});

test('FSM is 403 on POST /api/people', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const res = await createPerson(app, fsm, {
    firstName: 'New',
    lastName: 'Contact',
    email: 'new.contact@example.test',
    source: 'Meetup',
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: { code: 'forbidden' } });
});

test('create validation: missing name, bad email, no email+phone', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');

  const missingName = await createPerson(app, host, {
    firstName: '',
    lastName: '',
    email: 'ok@example.test',
    source: 'Meetup',
  });
  assert.equal(missingName.statusCode, 400);
  assert.equal(missingName.json().error.code, 'validation_failed');
  assert.ok(missingName.json().error.fields.firstName);
  assert.ok(missingName.json().error.fields.lastName);

  const badEmail = await createPerson(app, host, {
    firstName: 'Ada',
    lastName: 'Example',
    email: 'not-an-email',
    source: 'Meetup',
  });
  assert.equal(badEmail.statusCode, 400);
  assert.equal(badEmail.json().error.code, 'validation_failed');
  assert.ok(badEmail.json().error.fields.email);

  const noContact = await createPerson(app, host, {
    firstName: 'Ada',
    lastName: 'Example',
    source: 'Meetup',
  });
  assert.equal(noContact.statusCode, 400);
  assert.equal(noContact.json().error.code, 'validation_failed');
  assert.ok(noContact.json().error.fields.email || noContact.json().error.fields.phone);
});

test('manager create returns item with default Registered stage', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await createPerson(app, host, {
    firstName: 'Ivy',
    lastName: 'Testperson',
    email: 'ivy.testperson@example.test',
    source: 'Referral',
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.firstName, 'Ivy');
  assert.equal(body.lastName, 'Testperson');
  assert.equal(body.displayName, 'Ivy Testperson');
  assert.equal(body.stage, 'Registered');
  assert.equal(body.source, 'Referral');
  assert.equal(body.suppressed, false);
});

test('send-link is blocked when the person is suppressed (Gerald)', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const gerald = personByName(app, 'Gerald Mwangi');
  assert.equal(gerald.suppressed, 1);
  const res = await app.inject({
    method: 'POST',
    url: '/api/people/' + gerald.id + '/send-link',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: { code: 'suppressed' } });
});

test('send-link creates Offered appointment and offer panel can book or cancel', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = personByName(app, 'Karen Iversen');
  const sent = await app.inject({
    method: 'POST',
    url: '/api/people/' + karen.id + '/send-link',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(sent.statusCode, 200);
  const body = sent.json();
  assert.equal(body.appointment.status, 'Offered');
  assert.match(body.offerUrl, /^\/scheduling\?offer=/);
  assert.equal(body.appointment.actionDue, 'Link expires in 2 d');
  const token = body.offerUrl.split('offer=')[1];
  assert.ok(token.length >= 32);

  const eng = app.db.prepare(
    "SELECT type FROM engagements WHERE person_id = ? AND type = 'link_sent' ORDER BY id DESC",
  ).get(karen.id);
  assert.ok(eng);
  const audit = app.db.prepare(
    "SELECT action FROM audit_log WHERE action = 'person.send_link' AND entity_id = ?",
  ).get(String(karen.id));
  assert.ok(audit);

  const offer = await app.inject({
    method: 'GET',
    url: '/api/scheduling/offer/' + token,
    headers: { cookie: host.cookie },
  });
  assert.equal(offer.statusCode, 200);
  assert.equal(offer.json().appointment.id, body.appointment.id);
  assert.equal(offer.json().status, 'Offered');

  const booked = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + body.appointment.id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Booked' },
  });
  assert.equal(booked.statusCode, 200);
  assert.equal(booked.json().appointment.status, 'Booked');
});

test('merge re-points listed tables and keeps unique live email', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const orgId = twinId(app);
  const fsm = app.db.prepare("SELECT id FROM users WHERE email = 'fsm@twincities.example'").get();
  const at = DEMO_CLOCK;

  const winnerRes = await createPerson(app, host, {
    firstName: 'Winner',
    lastName: 'Keep',
    email: 'winner.keep@example.test',
    source: 'Other',
  });
  const loserRes = await createPerson(app, host, {
    firstName: 'Loser',
    lastName: 'Fold',
    email: 'loser.fold@example.test',
    source: 'Other',
  });
  assert.equal(winnerRes.statusCode, 201);
  assert.equal(loserRes.statusCode, 201);
  const winnerId = winnerRes.json().id;
  const loserId = loserRes.json().id;

  app.db.prepare(`
    INSERT INTO engagements (org_id, person_id, type, occurred_at, payload_json)
    VALUES (?, ?, 'history', ?, ?)
  `).run(orgId, loserId, at, JSON.stringify({ text: 'loser history' }));

  const appt = app.db.prepare(`
    INSERT INTO appointments (
      org_id, person_id, fsm_user_id, start_at, timezone, duration_min, status, created_at
    ) VALUES (?, ?, ?, ?, 'America/Chicago', 45, 'Completed', ?)
  `).run(orgId, loserId, fsm.id, '2026-08-20T10:00:00-05:00', at);
  const appointmentId = Number(appt.lastInsertRowid);

  app.db.prepare(`
    INSERT INTO assignments (org_id, person_id, user_id, kind, status, created_at)
    VALUES (?, ?, ?, 'fsm', 'open', ?)
  `).run(orgId, loserId, fsm.id, at);

  app.db.prepare(`
    INSERT INTO consent_records (org_id, person_id, channel, granted, granted_at, source)
    VALUES (?, ?, 'email', 1, '2026-08-20T00:00:00-05:00', 'test')
  `).run(orgId, winnerId);
  app.db.prepare(`
    INSERT INTO consent_records (org_id, person_id, channel, granted, granted_at, source)
    VALUES (?, ?, 'email', 1, '2026-08-10T00:00:00-05:00', 'test')
  `).run(orgId, loserId);

  const imp = app.db.prepare('SELECT id FROM imports WHERE org_id = ? LIMIT 1').get(orgId);
  app.db.prepare(`
    INSERT INTO import_rows (import_id, row_num, raw_json, disposition, match_person_id)
    VALUES (?, 99, '{}', 'duplicate', ?)
  `).run(imp.id, loserId);

  app.db.prepare(`
    INSERT INTO outcomes (
      org_id, appointment_id, person_id, fsm_user_id, delivered, client_id, created_at
    ) VALUES (?, ?, ?, ?, 'yes', 'merge-client-1', ?)
  `).run(orgId, appointmentId, loserId, fsm.id, at);

  app.db.prepare(`
    INSERT INTO stories (org_id, person_id, contributor, source, summary, stage, release, created_at)
    VALUES (?, ?, 'Loser Fold', 'test', 'merge story', 'Submitted', 'Not requested', ?)
  `).run(orgId, loserId, at);

  const merged = await app.inject({
    method: 'POST',
    url: '/api/people/' + winnerId + '/merge',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { loserId },
  });
  assert.equal(merged.statusCode, 200);
  assert.deepEqual(merged.json(), { winnerId, loserId });

  assert.equal(
    app.db.prepare('SELECT person_id FROM engagements WHERE payload_json LIKE ?').get('%"loser history"%').person_id,
    winnerId,
  );
  assert.equal(
    app.db.prepare('SELECT person_id FROM appointments WHERE id = ?').get(appointmentId).person_id,
    winnerId,
  );
  assert.ok(
    app.db.prepare(
      'SELECT id FROM assignments WHERE org_id = ? AND person_id = ? AND user_id = ?',
    ).get(orgId, winnerId, fsm.id),
  );
  const consent = app.db.prepare(
    'SELECT granted, granted_at, person_id FROM consent_records WHERE org_id = ? AND person_id = ? AND channel = ?',
  ).get(orgId, winnerId, 'email');
  assert.equal(consent.granted, 1);
  assert.equal(consent.granted_at, '2026-08-10T00:00:00-05:00');
  assert.equal(
    app.db.prepare('SELECT COUNT(*) AS c FROM consent_records WHERE org_id = ? AND channel = ? AND person_id IN (?, ?)')
      .get(orgId, 'email', winnerId, loserId).c,
    1,
  );
  assert.equal(
    app.db.prepare('SELECT match_person_id FROM import_rows WHERE row_num = 99 AND import_id = ?').get(imp.id).match_person_id,
    winnerId,
  );
  assert.equal(
    app.db.prepare('SELECT person_id FROM outcomes WHERE client_id = ?').get('merge-client-1').person_id,
    winnerId,
  );
  assert.equal(
    app.db.prepare("SELECT person_id FROM stories WHERE summary = 'merge story'").get().person_id,
    winnerId,
  );
  assert.equal(
    app.db.prepare('SELECT merged_into_id FROM people WHERE id = ?').get(loserId).merged_into_id,
    winnerId,
  );
  assert.ok(
    app.db.prepare("SELECT id FROM audit_log WHERE action = 'person.merge' AND entity_id = ?").get(String(winnerId)),
  );

  const liveDup = await createPerson(app, host, {
    firstName: 'Copy',
    lastName: 'Email',
    email: 'winner.keep@example.test',
    source: 'Other',
  });
  assert.equal(liveDup.statusCode, 409);
  assert.equal(liveDup.json().error.code, 'conflict');

  const reuseLoser = await createPerson(app, host, {
    firstName: 'Reuse',
    lastName: 'LoserMail',
    email: 'loser.fold@example.test',
    source: 'Other',
  });
  assert.equal(reuseLoser.statusCode, 201);
});

test('FSM cannot merge', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const karen = personByName(app, 'Karen Iversen');
  const tom = personByName(app, 'Tom Fitzgerald');
  const res = await app.inject({
    method: 'POST',
    url: '/api/people/' + karen.id + '/merge',
    headers: { cookie: fsm.cookie, 'x-csrf-token': fsm.csrf },
    payload: { loserId: tom.id },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: { code: 'forbidden' } });
});

test('PATCH without fsmUserId keeps an inactive-FSM assignment', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const priya = personByName(app, 'Priya Raman');
  const lindgren = app.db.prepare(
    "SELECT id, active FROM users WHERE email = 'lindgren@twincities.example'",
  ).get();
  assert.equal(lindgren.active, 0);
  const before = await app.inject({
    method: 'GET',
    url: '/api/people/' + priya.id,
    headers: { cookie: host.cookie },
  });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().fsmUserId, lindgren.id);
  assert.equal(before.json().fsm, 'S. Lindgren');

  const patched = await app.inject({
    method: 'PATCH',
    url: '/api/people/' + priya.id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { postalCode: '55401' },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().postalCode, '55401');
  assert.equal(patched.json().fsmUserId, lindgren.id);
  assert.equal(patched.json().fsm, 'S. Lindgren');

  const keep = await app.inject({
    method: 'PATCH',
    url: '/api/people/' + priya.id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { firstName: 'Priya', fsmUserId: lindgren.id },
  });
  assert.equal(keep.statusCode, 200);
  assert.equal(keep.json().fsmUserId, lindgren.id);
});
