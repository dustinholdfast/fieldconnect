function mergeConsent(db, orgId, winnerId, loserId) {
  const rows = db.prepare(
    `SELECT * FROM consent_records WHERE org_id = ? AND person_id IN (?, ?)`,
  ).all(orgId, winnerId, loserId);
  const byChannel = new Map();
  for (const row of rows) {
    const list = byChannel.get(row.channel) || [];
    list.push(row);
    byChannel.set(row.channel, list);
  }
  for (const channelRows of byChannel.values()) {
    const grantedRows = channelRows.filter((r) => r.granted);
    const keepGranted = grantedRows.length > 0;
    const pool = keepGranted ? grantedRows : channelRows;
    const grantedAt = pool
      .map((r) => r.granted_at)
      .filter(Boolean)
      .sort()[0] || null;
    pool.sort((a, b) => a.id - b.id);
    const keep = pool[0];
    db.prepare(`
      UPDATE consent_records
         SET person_id = ?, granted = ?, granted_at = ?, withdrawn_at = ?
       WHERE org_id = ? AND id = ?
    `).run(winnerId, keepGranted ? 1 : 0, grantedAt, keepGranted ? null : keep.withdrawn_at, orgId, keep.id);
    for (const row of channelRows) {
      if (row.id !== keep.id) {
        db.prepare(`DELETE FROM consent_records WHERE org_id = ? AND id = ?`).run(orgId, row.id);
      }
    }
  }
}

export function mergePeople(db, orgId, winnerId, loserId, at) {
  mergeConsent(db, orgId, winnerId, loserId);
  db.prepare(`UPDATE engagements SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE appointments SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE assignments SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  const dups = db.prepare(`
    SELECT user_id, kind, MIN(id) AS keep_id
      FROM assignments
     WHERE org_id = ? AND person_id = ?
     GROUP BY user_id, kind
    HAVING COUNT(*) > 1
  `).all(orgId, winnerId);
  for (const dup of dups) {
    db.prepare(`
      DELETE FROM assignments
       WHERE org_id = ? AND person_id = ? AND user_id = ? AND kind = ? AND id != ?
    `).run(orgId, winnerId, dup.user_id, dup.kind, dup.keep_id);
  }
  db.prepare(`
    UPDATE import_rows SET match_person_id = ?
     WHERE match_person_id = ?
       AND import_id IN (SELECT id FROM imports WHERE org_id = ?)
  `).run(winnerId, loserId, orgId);
  db.prepare(`UPDATE outcomes SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE stories SET person_id = ? WHERE org_id = ? AND person_id = ?`)
    .run(winnerId, orgId, loserId);
  db.prepare(`UPDATE people SET merged_into_id = ?, updated_at = ? WHERE org_id = ? AND id = ?`)
    .run(winnerId, at, orgId, loserId);
}
