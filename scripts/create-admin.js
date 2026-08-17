import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/password.js';

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || process.argv[i + 1] == null || process.argv[i + 1].startsWith('--')) {
    return null;
  }
  return process.argv[i + 1];
}

const orgName = flag('org');
const slug = flag('slug');
const email = flag('email');
const password = flag('password');

if (!orgName || !slug || !email || !password) {
  process.stderr.write('usage: node scripts/create-admin.js --org "…" --slug twin-cities --email admin@org.example --password \'…\'\n');
  process.exit(1);
}

const db = openDatabase();
try {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO organizations (slug, name, wave, timezone, status, created_at)
    VALUES (?, ?, 'Pilot', 'America/Chicago', 'live', ?)
    ON CONFLICT(slug) DO UPDATE SET name = excluded.name
  `).run(slug, orgName, createdAt);
  const orgId = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug).id;
  const passwordHash = await hashPassword(password);
  const initials = email.slice(0, 2).toUpperCase();
  db.prepare(`
    INSERT INTO users (org_id, email, password_hash, display_name, initials, role, active)
    VALUES (?, ?, ?, ?, ?, 'admin', 1)
    ON CONFLICT(org_id, email) DO UPDATE SET
      password_hash = excluded.password_hash,
      role = 'admin',
      active = 1
  `).run(orgId, email, passwordHash, email, initials);
  process.stdout.write(`admin ${email} ready for org ${slug}\n`);
} finally {
  db.close();
}
