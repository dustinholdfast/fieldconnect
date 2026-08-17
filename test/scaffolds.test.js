import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { openDatabase } from '../server/db.js';
import { seedDemo } from '../server/fixtures/demo.js';
import { enroll, sendOutbound } from '../server/journeys/enroll.js';
import { NotImplemented, pushBatch } from '../server/metapulse/adapter.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const WAVE_TABLES = {
  enrollments: ['id', 'org_id', 'person_id', 'journey_key', 'branch', 'status', 'exit_reason', 'enrolled_at', 'exited_at'],
  outbound_messages: ['id', 'org_id', 'enrollment_id', 'step_id', 'channel', 'status', 'scheduled_at', 'sent_at'],
  calendar_connections: ['id', 'org_id', 'user_id', 'provider', 'status', 'tokens_encrypted', 'last_sync_at'],
  training_progress: ['id', 'org_id', 'user_id', 'module_id', 'progress_pct', 'status', 'updated_at'],
  signoffs: ['id', 'org_id', 'user_id', 'track', 'supervisor_id', 'signed_at'],
  story_consents: ['id', 'org_id', 'story_id', 'channel', 'granted', 'granted_at', 'withdrawn_at'],
  candidates: ['id', 'org_id', 'name', 'source', 'stage', 'created_at'],
  orientation_sessions: ['id', 'org_id', 'title', 'session_on', 'registered', 'attended', 'qualified', 'activated'],
  org_memberships: ['id', 'user_id', 'org_id', 'role'],
  public_pages: ['id', 'org_id', 'slug', 'kind', 'campaign_id'],
};

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fc-scaffold-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(dir);
  t.after(() => { try { db.close(); } catch { /* closed */ } });
  return db;
}

test('adapter pushBatch records locally without a vendor SDK', () => {
  const result = pushBatch([{ email: 'a@example.test' }, {}]);
  assert.equal(result.accepted, 1);
  assert.equal(result.rejected, 1);
  const err = NotImplemented('wave-3');
  assert.equal(err.name, 'NotImplemented');
});

test('enroll writes a row and sends nothing', async (t) => {
  process.env.SEED_DEMO = 'true';
  const db = tempDb(t);
  await seedDemo(db);
  const person = db.prepare(`
    SELECT id, org_id FROM people WHERE org_id = (
      SELECT id FROM organizations WHERE slug = 'twin-cities'
    ) LIMIT 1
  `).get();
  const beforeSent = db.prepare(`SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'sent'`).get().c;

  const result = enroll(db, { orgId: person.org_id, personId: person.id, journeyKey: 'j1' });
  assert.ok(result.id);
  assert.deepEqual(result.sent, []);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM outbound_messages WHERE status = 'sent'`).get().c, beforeSent);
  const queued = db.prepare(`SELECT COUNT(*) AS c FROM outbound_messages WHERE enrollment_id = ? AND status = 'queued'`).get(result.id).c;
  assert.ok(queued > 0);
  const row = db.prepare('SELECT status, journey_key FROM enrollments WHERE id = ?').get(result.id);
  assert.equal(row.status, 'active');
  assert.equal(row.journey_key, 'j1');

  const sent = sendOutbound();
  assert.equal(sent.provider, 'local');

  const src = readFileSync(join(rootDir, 'server', 'journeys', 'enroll.js'), 'utf8');
  assert.doesNotMatch(src, /nodemailer|twilio|sendgrid|mailgun|postmark|@sendgrid|@twilio/i);
});

test('002_wave2_wave3.sql applies on a fresh DB with frozen columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-mig-'));
  try {
    const db = openDatabase(dir);
    const applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
    assert.deepEqual(applied, ['001_pilot.sql', '002_wave2_wave3.sql']);
    for (const [table, cols] of Object.entries(WAVE_TABLES)) {
      const info = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      assert.deepEqual(info, cols, table);
    }
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seed still has exactly 7 journeys and does not re-seed them', async (t) => {
  process.env.SEED_DEMO = 'true';
  const db = tempDb(t);
  await seedDemo(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journeys').get().c, 7);
  const keys = db.prepare('SELECT key FROM journeys ORDER BY key').all().map((r) => r.key);
  assert.deepEqual(keys, ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7']);
  await seedDemo(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM journeys').get().c, 7);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM candidates').get().c > 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM orientation_sessions').get().c > 0);
});
