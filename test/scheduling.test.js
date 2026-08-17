import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { endAt } from '../server/clock.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-sched-'));
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

function appointmentByPerson(app, name) {
  return app.db.prepare(`
    SELECT a.* FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = ?
     ORDER BY a.id ASC
  `).get(name);
}

test('mask excludes Sunday', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const res = await app.inject({
    method: 'GET',
    url: '/api/scheduling/slots',
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const dates = (body.days || []).map((d) => d.date);
  assert.equal(body.days.length, 6);
  assert.ok(!dates.includes('2026-08-23'), 'Sunday is excluded');
  assert.deepEqual(dates, [
    '2026-08-24', '2026-08-25', '2026-08-26',
    '2026-08-27', '2026-08-28', '2026-08-29',
  ]);
  for (const day of body.days) {
    assert.equal(day.slots.length, 10, day.date);
    assert.match(day.slots[0].start, /T09:00:00/);
    assert.match(day.slots[9].start, /T18:00:00/);
  }
});

test('slots are blocked by min notice and max 4', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const fsm = userByEmail(app, 'fsm@twincities.example');

  const before = await app.inject({
    method: 'GET',
    url: '/api/scheduling/slots',
    headers: { cookie: host.cookie },
  });
  assert.equal(before.statusCode, 200);
  const thu = before.json().days.find((d) => d.date === '2026-08-27');
  const noon = thu.slots.find((s) => s.start.includes('T12:00:00'));
  assert.equal(noon.state, 'blocked', 'today 12:00 is inside min notice');

  const fri = before.json().days.find((d) => d.date === '2026-08-28');
  const friMorning = fri.slots.find((s) => s.start.includes('T09:00:00'));
  assert.equal(friMorning.state, 'free');

  const names = ['Ada Pencilton', 'Milo Cartwheel', 'Bea Lamppost', 'Theo Paperhat'];
  const hours = [9, 10, 11, 12];
  for (let i = 0; i < 4; i += 1) {
    const person = personByName(app, names[i]);
    const booked = await app.inject({
      method: 'POST',
      url: '/api/appointments',
      headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
      payload: {
        personId: person.id,
        startAt: `2026-08-29T${String(hours[i]).padStart(2, '0')}:00:00-05:00`,
        fsmUserId: fsm.id,
        durationMin: 45,
      },
    });
    assert.equal(booked.statusCode, 201, names[i]);
    assert.equal(booked.json().appointment.status, 'Booked');
  }

  const after = await app.inject({
    method: 'GET',
    url: '/api/scheduling/slots',
    headers: { cookie: host.cookie },
  });
  const sat = after.json().days.find((d) => d.date === '2026-08-29');
  const nine = sat.slots.find((s) => s.start.includes('T09:00:00'));
  const thirteen = sat.slots.find((s) => s.start.includes('T13:00:00'));
  assert.equal(nine.state, 'booked');
  assert.equal(thirteen.state, 'blocked', 'day already at max_per_day');
});

test('appointment status transitions follow the machine', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = personByName(app, 'Karen Iversen');

  const sent = await app.inject({
    method: 'POST',
    url: '/api/people/' + karen.id + '/send-link',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { startAt: '2026-08-29T15:00:00-05:00' },
  });
  assert.equal(sent.statusCode, 200);
  const id = sent.json().appointment.id;
  assert.equal(sent.json().appointment.status, 'Offered');

  const toConfirmed = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Confirmed' },
  });
  assert.equal(toConfirmed.statusCode, 409);
  assert.equal(toConfirmed.json().error.code, 'conflict');

  const toBooked = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Booked' },
  });
  assert.equal(toBooked.statusCode, 200);
  assert.equal(toBooked.json().appointment.status, 'Booked');

  const backToOffered = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Offered' },
  });
  assert.equal(backToOffered.statusCode, 409);

  const toConfirmedOk = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Confirmed' },
  });
  assert.equal(toConfirmedOk.statusCode, 200);
  assert.equal(toConfirmedOk.json().appointment.status, 'Confirmed');

  const cancel = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Cancelled' },
  });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().appointment.status, 'Cancelled');

  const afterCancel = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Booked' },
  });
  assert.equal(afterCancel.statusCode, 409);

  const priya = appointmentByPerson(app, 'Priya Raman');
  assert.equal(priya.status, 'Completed');
  const fromDone = await app.inject({
    method: 'PATCH',
    url: '/api/appointments/' + priya.id,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { status: 'Cancelled' },
  });
  assert.equal(fromDone.statusCode, 409);
});

test('FSM sees only own appointment queue', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const whitfield = userByEmail(app, 'fsm@twincities.example');

  const own = await app.inject({
    method: 'GET',
    url: '/api/appointments',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(own.statusCode, 200);
  const items = own.json().items;
  assert.ok(items.length > 0);
  assert.ok(items.every((item) => item.fsmUserId === whitfield.id));
  assert.ok(items.some((item) => item.personName === 'Karen Iversen'));
  assert.ok(!items.some((item) => item.personName === 'Elena Duarte'));

  const orgWide = await app.inject({
    method: 'GET',
    url: '/api/appointments',
    headers: { cookie: host.cookie },
  });
  assert.equal(orgWide.statusCode, 200);
  assert.ok(orgWide.json().items.some((item) => item.personName === 'Elena Duarte'));

  const elena = appointmentByPerson(app, 'Elena Duarte');
  const hidden = await app.inject({
    method: 'GET',
    url: '/api/appointments/' + elena.id,
    headers: { cookie: fsm.cookie },
  });
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(hidden.json(), { error: { code: 'not_found' } });
});

test('end_at is derived from start_at + duration_min', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const karen = appointmentByPerson(app, 'Karen Iversen');
  const res = await app.inject({
    method: 'GET',
    url: '/api/appointments/' + karen.id,
    headers: { cookie: host.cookie },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.startAt, karen.start_at);
  assert.equal(body.durationMin, karen.duration_min);
  assert.equal(
    Date.parse(body.endAt),
    Date.parse(body.startAt) + body.durationMin * 60_000,
  );
  assert.equal(Date.parse(body.endAt), endAt(karen).getTime());
  assert.equal(Object.hasOwn(karen, 'end_at'), false);
});
