import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { now } from '../server/clock.js';
import { openDatabase } from '../server/db.js';
import { seedDemo } from '../server/fixtures/demo.js';
import {
  enqueue,
  KIND_REMINDERS,
  MAX_ATTEMPTS,
  runOnce,
} from '../server/jobs/runner.js';
import { buildApp } from '../server/index.js';

process.env.SEED_DEMO = 'true';

async function seededDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-jobs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  await seedDemo(db);
  return { db, dir };
}

async function seededApp(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'fc-jobs-app-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const app = await buildApp({ dataDir, jobs: false });
  t.after(() => app.close());
  return app;
}

test('runner retries unknown kinds and fails after MAX_ATTEMPTS', async (t) => {
  const { db } = await seededDb(t);
  const org = db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get();
  const id = enqueue(db, { orgId: org.id, kind: 'does_not_exist' });

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const result = runOnce(db);
    assert.equal(result.id, id);
    const row = db.prepare('SELECT status, attempts FROM jobs WHERE id = ?').get(id);
    assert.equal(row.attempts, i);
    if (i < MAX_ATTEMPTS) {
      assert.equal(result.status, 'queued');
      assert.equal(row.status, 'queued');
    } else {
      assert.equal(result.status, 'failed');
      assert.equal(row.status, 'failed');
    }
  }

  assert.equal(runOnce(db), null);
});

test('reminders respect demo clock: Booked within 24h flips, later stays Booked', async (t) => {
  const { db } = await seededDb(t);
  const org = db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get();
  const anita = db.prepare(`
    SELECT a.* FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = 'Anita Sørensen'
  `).get();
  assert.equal(anita.status, 'Booked');
  const nowMs = now(db).getTime();
  const anitaStart = Date.parse(anita.start_at);
  assert.ok(anitaStart - nowMs <= 24 * 60 * 60 * 1000, 'Anita must be inside the 24h window vs demo clock');

  const person = db.prepare("SELECT id FROM people WHERE display_name = 'Marcus Bell'").get();
  const fsm = db.prepare("SELECT id FROM users WHERE display_name = 'D. Whitfield'").get();
  const later = new Date(nowMs + 48 * 60 * 60 * 1000).toISOString();
  const laterInfo = db.prepare(`
    INSERT INTO appointments (
      org_id, person_id, fsm_user_id, start_at, timezone, duration_min, status, created_at
    ) VALUES (?, ?, ?, ?, 'America/Chicago', 45, 'Booked', ?)
  `).run(org.id, person.id, fsm.id, later, later);

  enqueue(db, { orgId: org.id, kind: KIND_REMINDERS });
  const result = runOnce(db);
  assert.equal(result.status, 'done');
  assert.ok(result.result.flipped >= 1);

  const anitaAfter = db.prepare('SELECT status, action_due FROM appointments WHERE id = ?').get(anita.id);
  assert.equal(anitaAfter.status, 'Reminder due');
  assert.equal(anitaAfter.action_due, 'Send 24 h reminder');
  const engagement = db.prepare(`
    SELECT type FROM engagements WHERE org_id = ? AND person_id = ? AND type = 'reminder_due'
  `).get(org.id, anita.person_id);
  assert.ok(engagement);

  const laterAfter = db.prepare('SELECT status FROM appointments WHERE id = ?').get(Number(laterInfo.lastInsertRowid));
  assert.equal(laterAfter.status, 'Booked');
});

test('reminders use demo clock, not wall clock', async (t) => {
  const { db } = await seededDb(t);
  const org = db.prepare("SELECT id FROM organizations WHERE slug = 'twin-cities'").get();
  const wall = Date.now();
  const anita = db.prepare(`
    SELECT a.start_at FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = 'Anita Sørensen'
  `).get();
  const start = Date.parse(anita.start_at);
  // Wall clock is 2026-08-17 in this workspace; even if not, seed start is demo "today 8pm".
  // A wall-clock 24h window would miss Anita whenever |start - wall| > 24h.
  const wallWouldMiss = start - wall > 24 * 60 * 60 * 1000;
  assert.ok(wallWouldMiss || start - now(db).getTime() <= 24 * 60 * 60 * 1000);

  db.prepare("UPDATE app_meta SET value = '2026-08-20T12:00:00-05:00' WHERE key = 'demo_clock'").run();
  const anitaBefore = db.prepare(`
    SELECT a.id, a.status FROM appointments a
      JOIN people p ON p.id = a.person_id AND p.org_id = a.org_id
     WHERE p.display_name = 'Anita Sørensen'
  `).get();
  enqueue(db, { orgId: org.id, kind: KIND_REMINDERS });
  runOnce(db);
  const afterEarlyClock = db.prepare('SELECT status FROM appointments WHERE id = ?').get(anitaBefore.id);
  assert.equal(afterEarlyClock.status, 'Booked', '7 days before the appointment, demo clock must not flip');

  db.prepare("UPDATE app_meta SET value = '2026-08-27T12:00:00-05:00' WHERE key = 'demo_clock'").run();
  enqueue(db, { orgId: org.id, kind: KIND_REMINDERS });
  runOnce(db);
  const afterDemo = db.prepare('SELECT status FROM appointments WHERE id = ?').get(anitaBefore.id);
  assert.equal(afterDemo.status, 'Reminder due');
});

test('GET /healthz stays cheap and does not run jobs', async (t) => {
  const app = await seededApp(t);
  const started = Date.now();
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.ok(Date.now() - started < 500);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, db: 'ok', jobs: 'off' });
});
