import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../server/db.js';

const REQUIRED_TABLES = [
  'app_meta',
  'organizations',
  'users',
  'sessions',
  'people',
  'consent_records',
  'campaigns',
  'engagements',
  'assignments',
  'appointments',
  'availability_rules',
  'products',
  'pathway_sets',
  'pathway_items',
  'outcomes',
  'outcome_line_items',
  'imports',
  'import_rows',
  'jobs',
  'exports',
  'audit_log',
  'outcome_submissions',
  'journeys',
  'journey_steps',
  'stories',
  'training_modules',
  'schema_migrations',
  'enrollments',
  'outbound_messages',
  'calendar_connections',
  'training_progress',
  'signoffs',
  'story_consents',
  'candidates',
  'orientation_sessions',
  'org_memberships',
  'public_pages',
];

function tableNames(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
  );
}

test('migrations apply twice idempotently and create required tables', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-schema-'));
  const db = openDatabase(dir);
  const first = tableNames(db);
  for (const name of REQUIRED_TABLES) {
    assert.ok(first.has(name), `missing table ${name}`);
  }
  assert.ok(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_people_org_email_live'").get(),
  );
  const applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(applied, ['001_pilot.sql', '002_wave2_wave3.sql']);
  db.close();

  const again = openDatabase(dir);
  const second = tableNames(again);
  assert.deepEqual([...second].sort(), [...first].sort());
  const appliedAgain = again.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(appliedAgain, ['001_pilot.sql', '002_wave2_wave3.sql']);
  again.close();
  rmSync(dir, { recursive: true, force: true });
});
