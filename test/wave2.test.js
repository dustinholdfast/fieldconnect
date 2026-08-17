import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { now } from '../server/clock.js';
import { openDatabase } from '../server/db.js';
import { seedDemo } from '../server/fixtures/demo.js';
import { enroll } from '../server/journeys/enroll.js';
import { deliverDue, enrollIfNeeded } from '../server/journeys/engine.js';
import { enqueue, KIND_RECONCILE, runOnce } from '../server/jobs/runner.js';
import { isLevel2Enabled, setLevel2Enabled } from '../server/metapulse/adapter.js';
import { buildApp } from '../server/index.js';
import { routingGate } from '../server/training/gates.js';
import { isQuietHour, parseStepOffsetMs } from '../server/journeys/timing.js';

process.env.SEED_DEMO = 'true';

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-w2-'));
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
  return { cookie: cookieHeader(res), csrf: res.json().csrfToken, user: res.json().user };
}

test('timing parser and quiet hours', () => {
  assert.equal(parseStepOffsetMs('Day 2 · 09:00'), 2 * 86400_000);
  assert.equal(parseStepOffsetMs('+2 hours'), 2 * 3600_000);
  assert.equal(parseStepOffsetMs('Quarter 2'), 90 * 86400_000);
  const night = new Date('2026-08-27T22:00:00-05:00');
  assert.equal(isQuietHour(night, 'America/Chicago'), true);
  const morning = new Date('2026-08-27T10:00:00-05:00');
  assert.equal(isQuietHour(morning, 'America/Chicago'), false);
});

test('deliverDue sends queued steps and respects suppression', async (t) => {
  const app = await seededApp(t);
  const person = app.db.prepare(`
    SELECT id, org_id FROM people WHERE display_name = 'Marcus Bell'
  `).get();
  const result = enroll(app.db, { orgId: person.org_id, personId: person.id, journeyKey: 'j3' });
  app.db.prepare(`
    UPDATE outbound_messages SET scheduled_at = '2026-08-26T12:00:00.000Z' WHERE enrollment_id = ?
  `).run(result.id);
  const first = deliverDue(app.db, person.org_id);
  assert.ok(first.sent > 0);
  app.db.prepare(`UPDATE people SET suppressed = 1 WHERE id = ?`).run(person.id);
  app.db.prepare(`
    UPDATE enrollments SET status = 'active', exit_reason = NULL, exited_at = NULL WHERE id = ?
  `).run(result.id);
  app.db.prepare(`
    UPDATE outbound_messages SET scheduled_at = '2026-08-26T12:00:00.000Z', status = 'queued'
     WHERE enrollment_id = ?
  `).run(result.id);
  const second = deliverDue(app.db, person.org_id);
  assert.ok(second.skipped >= 1);
});

test('outcome enrolls the assigned journey', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const appt = app.db.prepare(`
    SELECT a.id FROM appointments a
      JOIN people p ON p.id = a.person_id
     WHERE p.display_name = 'Karen Iversen' AND a.status = 'Confirmed'
  `).get();
  assert.ok(appt);
  const res = await app.inject({
    method: 'POST',
    url: '/api/outcomes',
    headers: { cookie: fsm.cookie, 'x-csrf-token': fsm.csrf, 'idempotency-key': 'w2-out-1' },
    payload: {
      appointmentId: appt.id,
      clientId: 'w2-out-1',
      delivered: 'no',
      channel: 'Email',
      consents: { followup: true },
    },
  });
  assert.equal(res.statusCode, 201);
  const enr = app.db.prepare(`
    SELECT e.journey_key FROM enrollments e
      JOIN people p ON p.id = e.person_id
     WHERE p.display_name = 'Karen Iversen' AND e.journey_key = 'j2'
  `).get();
  assert.ok(enr);
});

test('story publish requires consent; withdraw unpublishes', async (t) => {
  const app = await seededApp(t);
  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const priya = app.db.prepare(`SELECT id, stage FROM stories WHERE contributor = 'Priya Raman'`).get();
  assert.equal(priya.stage, 'Submitted');
  let stage = priya.stage;
  for (let i = 0; i < 8; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/stories/${priya.id}/advance`,
      headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
      payload: {},
    });
    if (res.statusCode === 409) {
      assert.equal(res.json().error.code, 'consent_required');
      break;
    }
    stage = res.json().stage;
  }
  assert.notEqual(stage, 'Published');

  const grant = await app.inject({
    method: 'POST',
    url: `/api/stories/${priya.id}/consents`,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { channel: 'newsletter' },
  });
  assert.equal(grant.statusCode, 200);

  let published = false;
  for (let i = 0; i < 8; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/stories/${priya.id}/advance`,
      headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    if (res.json().stage === 'Published') {
      published = true;
      break;
    }
  }
  assert.equal(published, true);

  const withdraw = await app.inject({
    method: 'POST',
    url: `/api/stories/${priya.id}/consents/newsletter/withdraw`,
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: {},
  });
  assert.equal(withdraw.statusCode, 200);
  assert.equal(withdraw.json().stage, 'Approved');
});

test('unsigned FSM cannot book; Whitfield is gated on', async (t) => {
  const app = await seededApp(t);
  const org = app.db.prepare(`SELECT id FROM organizations WHERE slug = 'twin-cities'`).get();
  const whitfield = app.db.prepare(`SELECT id FROM users WHERE display_name = 'D. Whitfield'`).get();
  assert.equal(routingGate(app.db, org.id, whitfield.id).routingEnabled, true);

  const host = await loginAs(app, 'host@twincities.example', 'demo-host-2026');
  const lindgren = app.db.prepare(`SELECT id FROM users WHERE display_name = 'S. Lindgren'`).get();
  app.db.prepare(`UPDATE users SET active = 1 WHERE id = ?`).run(lindgren.id);
  const person = app.db.prepare(`SELECT id FROM people WHERE display_name = 'Marcus Bell'`).get();
  const start = new Date(now(app.db).getTime() + 48 * 3600_000).toISOString();
  const res = await app.inject({
    method: 'POST',
    url: '/api/appointments',
    headers: { cookie: host.cookie, 'x-csrf-token': host.csrf },
    payload: { personId: person.id, startAt: start, fsmUserId: lindgren.id },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, 'routing_gated');
});

test('calendar connect blocks a demo busy slot', async (t) => {
  const app = await seededApp(t);
  const fsm = await loginAs(app, 'fsm@twincities.example', 'demo-fsm-2026');
  const created = await app.inject({
    method: 'POST',
    url: '/api/calendar/connections',
    headers: { cookie: fsm.cookie, 'x-csrf-token': fsm.csrf },
    payload: { provider: 'google' },
  });
  assert.equal(created.statusCode, 201);
  const slots = await app.inject({
    method: 'GET',
    url: '/api/scheduling/slots',
    headers: { cookie: fsm.cookie },
  });
  assert.equal(slots.statusCode, 200);
  const hit = slots.json().days.flatMap((d) => d.slots).find((s) => s.start.startsWith('2026-08-28T15:00'));
  assert.ok(hit);
  assert.equal(hit.state, 'blocked');
  const open = slots.json().days.flatMap((d) => d.slots).find((s) => s.start.startsWith('2026-08-28T14:00'));
  assert.ok(open);
  assert.equal(open.state, 'free');
});

test('L2 reconcile job pushes when enabled', async (t) => {
  const app = await seededApp(t);
  const org = app.db.prepare(`SELECT id FROM organizations WHERE slug = 'twin-cities'`).get();
  setLevel2Enabled(app.db, org.id, true);
  assert.equal(isLevel2Enabled(app.db, org.id), true);
  enqueue(app.db, { orgId: org.id, kind: KIND_RECONCILE });
  const result = runOnce(app.db, { dataDir: app.dataDir });
  assert.equal(result.status, 'done');
  assert.ok(result.result.accepted > 0);
});

test('enrollIfNeeded ignores non-j keys', () => {
  assert.equal(enrollIfNeeded({ prepare() { return { get() { return null; } }; } }, {
    orgId: 1, personId: 1, journeyKey: 'div6-invite',
  }), null);
});
