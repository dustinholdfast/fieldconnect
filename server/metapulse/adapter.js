import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function NotImplemented(wave) {
  const err = new Error(`NotImplemented('${wave}')`);
  err.name = 'NotImplemented';
  err.wave = wave;
  return err;
}

export function isLevel2Enabled(db, orgId) {
  const row = db.prepare(`
    SELECT value FROM app_meta WHERE key = ?
  `).get(`metapulse_l2:${orgId}`);
  return row?.value === 'live';
}

export function setLevel2Enabled(db, orgId, enabled) {
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`metapulse_l2:${orgId}`, enabled ? 'live' : 'off');
}

export function pushBatch(records, { orgId, dataDir } = {}) {
  const rows = Array.isArray(records) ? records : [];
  const accepted = [];
  const rejected = [];
  for (const row of rows) {
    if (row && (row.external_id || row.email || row.id)) accepted.push(row);
    else rejected.push({ row, reason: 'missing_identity' });
  }
  if (dataDir && orgId != null) {
    const dir = join(dataDir, 'files', String(orgId), 'metapulse');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(dir, `push-${stamp}.json`),
      JSON.stringify({ orgId, accepted: accepted.length, rejected: rejected.length, records: accepted }, null, 2),
    );
  }
  return { accepted: accepted.length, rejected: rejected.length };
}
