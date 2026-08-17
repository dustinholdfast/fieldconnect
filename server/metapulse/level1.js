import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso } from '../clock.js';
import { dataDir as defaultDataDir } from '../db.js';

export const L1_COLUMNS = [
  'external_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'event_code',
  'fsm',
  'stage',
  'ruin_category',
  'product_skus',
  'revenue_cents',
  'outcome_at',
  'consent_email',
  'consent_sms',
  'suppressed',
];

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(values) {
  return values.map(csvEscape).join(',');
}

function latestByPerson(rows, personKey, cmpKeys) {
  const map = new Map();
  for (const row of rows) {
    const id = row[personKey];
    const prev = map.get(id);
    if (!prev) {
      map.set(id, row);
      continue;
    }
    let better = false;
    for (const key of cmpKeys) {
      const a = prev[key];
      const b = row[key];
      if (a === b) continue;
      better = a < b;
      break;
    }
    if (better) map.set(id, row);
  }
  return map;
}

function grantedChannel(rows, channel) {
  return (rows || []).some((row) => (
    row.channel === channel && Number(row.granted) === 1 && !row.withdrawn_at
  )) ? 1 : 0;
}

export function collectLevel1Rows(db, orgId) {
  const people = db.prepare(`
    SELECT id, first_name, last_name, email, phone, stage, ruin_category, suppressed
      FROM people
     WHERE org_id = ? AND merged_into_id IS NULL
     ORDER BY id ASC
  `).all(orgId);

  const skipped = db.prepare(`
    SELECT COUNT(*) AS c FROM people WHERE org_id = ? AND merged_into_id IS NOT NULL
  `).get(orgId).c;

  const fsmRows = db.prepare(`
    SELECT a.id, a.person_id, u.display_name AS fsm
      FROM assignments a
      JOIN users u ON u.id = a.user_id AND u.org_id = a.org_id
     WHERE a.org_id = ? AND a.kind = 'fsm'
     ORDER BY a.id ASC
  `).all(orgId);
  const fsmByPerson = latestByPerson(fsmRows, 'person_id', ['id']);

  const eventRows = db.prepare(`
    SELECT e.person_id, c.code AS event_code, e.occurred_at, e.id
      FROM engagements e
      JOIN campaigns c ON c.id = e.campaign_id AND c.org_id = e.org_id
     WHERE e.org_id = ? AND e.campaign_id IS NOT NULL
     ORDER BY e.occurred_at ASC, e.id ASC
  `).all(orgId);
  const eventByPerson = latestByPerson(eventRows, 'person_id', ['occurred_at', 'id']);

  const apptEvents = db.prepare(`
    SELECT a.person_id, c.code AS event_code, a.start_at, a.id
      FROM appointments a
      JOIN campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
     WHERE a.org_id = ? AND a.campaign_id IS NOT NULL
     ORDER BY a.start_at ASC, a.id ASC
  `).all(orgId);
  const apptEventByPerson = latestByPerson(apptEvents, 'person_id', ['start_at', 'id']);

  const outcomes = db.prepare(`
    SELECT id, person_id, created_at
      FROM outcomes
     WHERE org_id = ?
     ORDER BY created_at ASC, id ASC
  `).all(orgId);
  const latestOutcome = latestByPerson(outcomes, 'person_id', ['created_at', 'id']);

  const lineRows = db.prepare(`
    SELECT oli.outcome_id, p.sku, oli.qty, oli.unit_price_cents
      FROM outcome_line_items oli
      JOIN outcomes o ON o.id = oli.outcome_id AND o.org_id = ?
      JOIN products p ON p.id = oli.product_id AND p.org_id = o.org_id
     ORDER BY p.sku ASC
  `).all(orgId);
  const linesByOutcome = new Map();
  for (const row of lineRows) {
    const list = linesByOutcome.get(row.outcome_id) || [];
    list.push(row);
    linesByOutcome.set(row.outcome_id, list);
  }

  const consents = db.prepare(`
    SELECT person_id, channel, granted, withdrawn_at
      FROM consent_records
     WHERE org_id = ? AND channel IN ('email', 'sms')
  `).all(orgId);
  const consentsByPerson = new Map();
  for (const row of consents) {
    const list = consentsByPerson.get(row.person_id) || [];
    list.push(row);
    consentsByPerson.set(row.person_id, list);
  }

  const rows = people.map((person) => {
    const outcome = latestOutcome.get(person.id);
    const lines = outcome ? (linesByOutcome.get(outcome.id) || []) : [];
    const skus = [...new Set(lines.map((line) => line.sku).filter(Boolean))];
    const revenue = lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_price_cents) || 0), 0);
    const channels = consentsByPerson.get(person.id) || [];
    return {
      external_id: person.id,
      first_name: person.first_name || '',
      last_name: person.last_name || '',
      email: person.email || '',
      phone: person.phone || '',
      event_code: eventByPerson.get(person.id)?.event_code
        || apptEventByPerson.get(person.id)?.event_code
        || '',
      fsm: fsmByPerson.get(person.id)?.fsm || '',
      stage: person.stage || '',
      ruin_category: person.ruin_category || '',
      product_skus: skus.join(';'),
      revenue_cents: revenue,
      outcome_at: outcome?.created_at || '',
      consent_email: grantedChannel(channels, 'email'),
      consent_sms: grantedChannel(channels, 'sms'),
      suppressed: person.suppressed ? 1 : 0,
    };
  });

  return { rows, skipped };
}

export function renderLevel1Csv(rows) {
  const lines = [csvLine(L1_COLUMNS)];
  for (const row of rows) {
    lines.push(csvLine(L1_COLUMNS.map((col) => row[col])));
  }
  return `${lines.join('\n')}\n`;
}

export function writeLevel1Csv(db, { orgId, dataDir, jobId } = {}) {
  const root = dataDir || defaultDataDir();
  const dir = join(root, 'files', String(orgId), 'exports');
  mkdirSync(dir, { recursive: true });
  const stamp = nowIso(db).replace(/[^0-9]/g, '').slice(0, 14) || String(Date.now());
  const filename = `metapulse-l1-${stamp}-${jobId ?? 'x'}.csv`;
  const storedPath = join(dir, filename);
  const { rows, skipped } = collectLevel1Rows(db, orgId);
  const csv = renderLevel1Csv(rows);
  writeFileSync(storedPath, csv, 'utf8');
  const at = nowIso(db);
  const info = db.prepare(`
    INSERT INTO exports (org_id, job_id, kind, filename, stored_path, row_count, created_at)
    VALUES (?, ?, 'metapulse_l1', ?, ?, ?, ?)
  `).run(orgId, jobId ?? null, filename, storedPath, rows.length, at);
  return {
    exportId: Number(info.lastInsertRowid),
    filename,
    storedPath,
    rowCount: rows.length,
    skipped,
  };
}
