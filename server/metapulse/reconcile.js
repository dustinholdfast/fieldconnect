import { nowIso } from '../clock.js';
import { isLevel2Enabled, pushBatch } from './adapter.js';
import { collectLevel1Rows } from './level1.js';

export function reconcileOrg(db, { orgId, dataDir } = {}) {
  if (!isLevel2Enabled(db, orgId)) {
    return { status: 'paused', reason: 'level2_off', sent: 0, accepted: 0, rejected: 0 };
  }
  const records = collectLevel1Rows(db, orgId).rows;
  const result = pushBatch(records, { orgId, dataDir });
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`metapulse_l3_last:${orgId}`, nowIso(db));
  return { status: 'ok', sent: records.length, ...result };
}
