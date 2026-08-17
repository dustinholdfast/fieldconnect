import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function dataDir() {
  return process.env.FIELDCONNECT_DATA_DIR || './data';
}

export function dbPath(dir = dataDir()) {
  return join(dir, 'fieldconnect.sqlite');
}

function appliedNames(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!table) return new Set();
  return new Set(db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name));
}

export function migrate(db) {
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  for (const name of files) {
    if (appliedNames(db).has(name)) continue;
    const sql = readFileSync(join(migrationsDir, name), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

export function openDatabase(dir = dataDir()) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath(dir));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function withOrg(db, orgId) {
  if (orgId == null) throw new Error('withOrg requires orgId');
  return {
    orgId,
    all(sql, params = []) { return db.prepare(sql).all(orgId, ...params); },
    get(sql, params = []) { return db.prepare(sql).get(orgId, ...params); },
    run(sql, params = []) { return db.prepare(sql).run(orgId, ...params); },
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const db = openDatabase();
  db.close();
  process.stdout.write(`migrated ${dbPath()}\n`);
}
