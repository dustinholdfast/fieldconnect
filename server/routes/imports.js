import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { write as writeAudit } from '../audit.js';
import { nowIso } from '../clock.js';
import { withOrg } from '../db.js';
import { ImportRowLimitError, isXlsx, parseCsv, rowObject, sampleRows } from '../imports/parse.js';
import { mergePeople } from '../people/merge.js';
import {
  EMAIL_RE,
  applyMapping,
  mappingHasEmail,
  normalizeMapping,
  phoneKey,
  suggestMapping,
} from '../../shared/import/mapping.js';

const STATUS_LABELS = {
  uploaded: 'Uploaded',
  mapped: 'Mapped',
  validated: 'Pending activation',
  active: 'Active',
  rejected: 'Rejected — no lawful basis',
};

function sendError(reply, status, code, extra = {}) {
  return reply.code(status).send({ error: { code, ...extra } });
}

function stripOrg(body) {
  if (!body || typeof body !== 'object') return {};
  const { org_id: _orgIdSnake, orgId: _orgIdCamel, ...rest } = body;
  return rest;
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function loadImport(org, id) {
  if (!Number.isInteger(id) || id < 1) return null;
  return org.get(`SELECT * FROM imports WHERE org_id = ? AND id = ?`, [id]);
}

function uniqueConflict(err) {
  return err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE/i.test(String(err.message)));
}

function importDir(app, orgId) {
  const dir = join(app.dataDir, 'files', String(orgId), 'imports');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFilename(name) {
  const base = basename(String(name || 'upload.csv')) || 'upload.csv';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180) || 'upload.csv';
}

function readStoredCsv(row) {
  if (!row?.stored_path) return null;
  try {
    return readFileSync(row.stored_path);
  } catch {
    return null;
  }
}

function columnsFromImport(row, storedRows) {
  if (storedRows.length) return Object.keys(parseJson(storedRows[0].raw_json, {}));
  const buf = readStoredCsv(row);
  if (!buf) return [];
  try { return parseCsv(buf).columns; } catch { return []; }
}

function samplesFromImport(storedRows, columns) {
  return storedRows.slice(0, 5).map((r) => {
    const obj = parseJson(r.raw_json, {});
    return columns.map((c) => (obj[c] == null ? '' : String(obj[c])));
  });
}

function loadImportRows(db, importId) {
  return db.prepare(
    `SELECT id, row_num, raw_json, disposition, match_person_id, error
       FROM import_rows WHERE import_id = ? ORDER BY row_num ASC`,
  ).all(importId);
}

function statusLabel(row) {
  if (row.status === 'rejected') {
    const stats = parseJson(row.stats_json, {});
    if (stats.reason) return `Rejected — ${stats.reason}`;
  }
  return STATUS_LABELS[row.status] || row.status;
}

function statsOf(row) {
  const stats = parseJson(row.stats_json, {}) || {};
  return {
    rowsRead: stats.rowsRead ?? 0,
    valid: stats.valid ?? 0,
    duplicates: stats.duplicates ?? 0,
    suppressed: stats.suppressed ?? (stats.rejected ?? 0),
    rejected: stats.rejected ?? 0,
    peopleCreated: stats.peopleCreated ?? 0,
    peopleMerged: stats.peopleMerged ?? 0,
    reason: stats.reason,
  };
}

function listItem(row) {
  const stats = statsOf(row);
  return {
    id: row.id,
    filename: row.filename,
    uploadedAt: row.uploaded_at,
    status: row.status,
    statusLabel: statusLabel(row),
    sourceLabel: row.source_label,
    lawfulBasis: row.lawful_basis,
    rowsRead: stats.rowsRead,
    valid: stats.valid,
    duplicates: stats.duplicates,
    suppressed: stats.suppressed,
    rejected: stats.rejected,
    peopleCreated: stats.peopleCreated,
    peopleMerged: stats.peopleMerged,
  };
}

function detail(db, row) {
  const storedRows = loadImportRows(db, row.id);
  const columns = columnsFromImport(row, storedRows);
  const mapping = normalizeMapping(parseJson(row.mapping_json, {}) || {}, columns.length ? columns : null);
  const stats = statsOf(row);
  return {
    ...listItem(row),
    mapping,
    columns,
    samples: samplesFromImport(storedRows, columns),
    stats,
    journeyKey: row.journey_key,
  };
}

function livePeopleIndex(org) {
  const rows = org.all(
    `SELECT id, email, phone, suppressed FROM people WHERE org_id = ? AND merged_into_id IS NULL`,
  );
  const byEmail = new Map();
  const byPhone = new Map();
  for (const person of rows) {
    if (person.email) byEmail.set(String(person.email).trim().toLowerCase(), person);
    const key = phoneKey(person.phone);
    if (key) byPhone.set(key, person);
  }
  return { byEmail, byPhone };
}

function classifyMapped(mapped, index, seen) {
  const email = mapped.email ? String(mapped.email).trim() : '';
  const phone = mapped.phone ? String(mapped.phone).trim() : '';
  const pKey = phoneKey(phone);

  if (email && !EMAIL_RE.test(email)) {
    return { disposition: 'rejected', error: 'invalid email' };
  }
  if (!email && !pKey) {
    return { disposition: 'rejected', error: 'empty identity' };
  }

  const emailKey = email ? email.toLowerCase() : '';
  const existing = (emailKey && index.byEmail.get(emailKey))
    || (pKey && index.byPhone.get(pKey))
    || null;

  if (existing) {
    if (existing.suppressed) {
      return { disposition: 'suppressed', matchPersonId: existing.id };
    }
    return { disposition: 'duplicate', matchPersonId: existing.id };
  }

  if ((emailKey && seen.emails.has(emailKey)) || (pKey && seen.phones.has(pKey))) {
    return { disposition: 'duplicate' };
  }

  if (emailKey) seen.emails.add(emailKey);
  if (pKey) seen.phones.add(pKey);
  return { disposition: 'valid' };
}

function emptyStats() {
  return { rowsRead: 0, valid: 0, duplicates: 0, suppressed: 0, rejected: 0 };
}

function validateImport(db, org, row) {
  const storedRows = loadImportRows(db, row.id);
  const columns = columnsFromImport(row, storedRows);
  const mapping = normalizeMapping(parseJson(row.mapping_json, {}) || suggestMapping(columns), columns);
  if (!mappingHasEmail(mapping)) {
    return { error: { fields: { mapping: 'Email must be mapped' } } };
  }

  const index = livePeopleIndex(org);
  const seen = { emails: new Set(), phones: new Set() };
  const stats = emptyStats();
  stats.rowsRead = storedRows.length;
  const statKey = { valid: 'valid', duplicate: 'duplicates', suppressed: 'suppressed', rejected: 'rejected' };

  const update = db.prepare(`
    UPDATE import_rows
       SET disposition = ?, match_person_id = ?, error = ?
     WHERE id = ?
  `);

  for (const stored of storedRows) {
    const raw = parseJson(stored.raw_json, {});
    const mapped = applyMapping(raw, mapping);
    const result = classifyMapped(mapped, index, seen);
    stats[statKey[result.disposition]] += 1;
    update.run(result.disposition, result.matchPersonId ?? null, result.error ?? null, stored.id);
  }

  return { stats, mapping };
}

function displayName(mapped) {
  const name = `${mapped.first_name || ''} ${mapped.last_name || ''}`.trim();
  return name || mapped.email || mapped.phone || 'Imported contact';
}

function sourceNotes(mapped) {
  const parts = [mapped.source_notes, mapped.tag].filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

function insertImportedPerson(org, mapped, lawfulBasis, at, { omitEmail = false } = {}) {
  const first = mapped.first_name || '';
  const last = mapped.last_name || '';
  const email = omitEmail ? null : (mapped.email ? mapped.email.trim() : null);
  const phone = mapped.phone ? mapped.phone.trim() : null;
  const info = org.run(
    `INSERT INTO people (
       org_id, first_name, last_name, display_name, email, phone, postal_code,
       source, source_notes, stage, lawful_basis, journey_key, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Div 6 list', ?, 'Registered', ?, 'div6-invite', ?, ?)`,
    [
      first,
      last,
      displayName(mapped),
      email || null,
      phone || null,
      mapped.postal_code || null,
      sourceNotes(mapped),
      lawfulBasis,
      at,
      at,
    ],
  );
  return Number(info.lastInsertRowid);
}

function writeImportedEngagement(org, session, personId, importId, at) {
  org.run(
    `INSERT INTO engagements (org_id, person_id, type, occurred_at, payload_json, created_by)
     VALUES (?, ?, 'imported', ?, ?, ?)`,
    [personId, at, JSON.stringify({ text: 'Imported from list', importId }), session.userId],
  );
}

function findLiveByEmail(org, email) {
  if (!email) return null;
  return org.get(
    `SELECT * FROM people WHERE org_id = ? AND lower(email) = lower(?) AND merged_into_id IS NULL`,
    [email],
  );
}

function findLiveByPhone(org, phone) {
  const key = phoneKey(phone);
  if (!key) return null;
  const rows = org.all(
    `SELECT * FROM people WHERE org_id = ? AND merged_into_id IS NULL AND phone IS NOT NULL`,
  );
  return rows.find((p) => phoneKey(p.phone) === key) || null;
}

function resolveMatch(org, mapped, matchPersonId) {
  if (matchPersonId) {
    const row = org.get(
      `SELECT * FROM people WHERE org_id = ? AND id = ? AND merged_into_id IS NULL`,
      [matchPersonId],
    );
    if (row) return row;
  }
  return findLiveByEmail(org, mapped.email) || findLiveByPhone(org, mapped.phone);
}

function mergeIncoming(db, org, session, winner, mapped, importId, lawfulBasis, at) {
  const loserId = insertImportedPerson(org, mapped, lawfulBasis, at, { omitEmail: true });
  writeImportedEngagement(org, session, loserId, importId, at);
  mergePeople(db, session.orgId, winner.id, loserId, at);
  return winner.id;
}

function activateImport(db, org, session, row, at) {
  const validated = validateImport(db, org, row);
  if (validated.error) return validated;

  const storedRows = loadImportRows(db, row.id);
  const mapping = validated.mapping;
  const stats = { ...validated.stats, peopleCreated: 0, peopleMerged: 0 };
  const createdByKey = new Map();

  const setMatch = db.prepare(`
    UPDATE import_rows SET match_person_id = ? WHERE id = ?
  `);

  for (const stored of storedRows) {
    const raw = parseJson(stored.raw_json, {});
    const mapped = applyMapping(raw, mapping);
    const emailKey = mapped.email ? mapped.email.trim().toLowerCase() : '';
    const pKey = phoneKey(mapped.phone);

    if (stored.disposition === 'rejected' || stored.disposition === 'suppressed') continue;

    if (stored.disposition === 'valid') {
      let personId;
      try {
        personId = insertImportedPerson(org, mapped, row.lawful_basis, at);
      } catch (err) {
        if (!uniqueConflict(err)) throw err;
        const existing = resolveMatch(org, mapped, stored.match_person_id);
        if (!existing) throw err;
        if (existing.suppressed) continue;
        personId = mergeIncoming(db, org, session, existing, mapped, row.id, row.lawful_basis, at);
        setMatch.run(personId, stored.id);
        stats.valid = Math.max(0, stats.valid - 1);
        stats.duplicates += 1;
        stats.peopleMerged += 1;
        if (emailKey) createdByKey.set(`e:${emailKey}`, personId);
        if (pKey) createdByKey.set(`p:${pKey}`, personId);
        continue;
      }
      writeImportedEngagement(org, session, personId, row.id, at);
      setMatch.run(personId, stored.id);
      stats.peopleCreated += 1;
      if (emailKey) createdByKey.set(`e:${emailKey}`, personId);
      if (pKey) createdByKey.set(`p:${pKey}`, personId);
      continue;
    }

    if (stored.disposition === 'duplicate') {
      let winner = resolveMatch(org, mapped, stored.match_person_id);
      if (!winner) {
        const createdId = (emailKey && createdByKey.get(`e:${emailKey}`))
          || (pKey && createdByKey.get(`p:${pKey}`));
        if (createdId) {
          winner = org.get(
            `SELECT * FROM people WHERE org_id = ? AND id = ? AND merged_into_id IS NULL`,
            [createdId],
          );
        }
      }
      if (!winner || winner.suppressed) continue;
      mergeIncoming(db, org, session, winner, mapped, row.id, row.lawful_basis, at);
      setMatch.run(winner.id, stored.id);
      stats.peopleMerged += 1;
    }
  }

  return { stats, mapping };
}

export async function registerImportRoutes(app) {
  app.get('/api/imports', async (request) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const rows = org.all(
      `SELECT * FROM imports WHERE org_id = ? ORDER BY uploaded_at DESC, id DESC`,
    );
    return { items: rows.map(listItem) };
  });

  app.get('/api/imports/:id', async (request, reply) => {
    const org = withOrg(app.db, request.fcSession.orgId);
    const row = loadImport(org, Number(request.params.id));
    if (!row) return sendError(reply, 404, 'not_found');
    return detail(app.db, row);
  });

  app.post('/api/imports', async (request, reply) => {
    const session = request.fcSession;
    if (!request.isMultipart()) {
      return sendError(reply, 400, 'validation_failed', { message: 'Expected a CSV file' });
    }

    let file;
    try {
      file = await request.file();
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
        return sendError(reply, 413, 'import_row_limit');
      }
      throw err;
    }
    if (!file) return sendError(reply, 400, 'validation_failed', { message: 'Expected a CSV file' });

    let buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
        return sendError(reply, 413, 'import_row_limit');
      }
      throw err;
    }

    const filename = file.filename || 'upload.csv';
    if (isXlsx(filename, file.mimetype, buffer)) {
      return sendError(reply, 415, 'unsupported_media');
    }

    let parsed;
    try {
      parsed = parseCsv(buffer);
    } catch (err) {
      if (err instanceof ImportRowLimitError || err.code === 'import_row_limit') {
        return sendError(reply, 413, 'import_row_limit');
      }
      return sendError(reply, 400, 'validation_failed', { message: 'Could not parse CSV' });
    }
    if (!parsed.columns.length || !parsed.rows.length) {
      return sendError(reply, 400, 'validation_failed', { message: 'CSV has no data rows' });
    }

    const org = withOrg(app.db, session.orgId);
    const at = nowIso(app.db);
    const mapping = suggestMapping(parsed.columns);
    const storedName = `${randomBytes(8).toString('hex')}-${safeFilename(filename)}`;
    const storedPath = join(importDir(app, session.orgId), storedName);
    writeFileSync(storedPath, buffer);

    const info = org.run(
      `INSERT INTO imports (
         org_id, filename, stored_path, uploaded_by, uploaded_at, status, mapping_json
       ) VALUES (?, ?, ?, ?, ?, 'uploaded', ?)`,
      [filename, storedPath, session.userId, at, JSON.stringify(mapping)],
    );
    const id = Number(info.lastInsertRowid);

    const insertRow = app.db.prepare(`
      INSERT INTO import_rows (import_id, row_num, raw_json) VALUES (?, ?, ?)
    `);
    const writeRows = app.db.transaction(() => {
      parsed.rows.forEach((values, i) => {
        insertRow.run(id, i + 1, JSON.stringify(rowObject(parsed.columns, values)));
      });
    });
    writeRows();

    writeAudit(app.db, {
      orgId: session.orgId,
      actorUserId: session.userId,
      action: 'import.upload',
      entityType: 'import',
      entityId: id,
      after: { filename, rowsRead: parsed.rows.length },
    });

    return reply.code(201).send({
      id,
      filename,
      status: 'uploaded',
      columns: parsed.columns,
      samples: sampleRows(parsed.rows),
      mapping,
    });
  });

  app.patch('/api/imports/:id', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const row = loadImport(org, Number(request.params.id));
    if (!row) return sendError(reply, 404, 'not_found');
    if (row.status === 'active' || row.status === 'rejected') {
      return sendError(reply, 409, 'conflict');
    }
    const body = stripOrg(request.body);
    const storedRows = loadImportRows(app.db, row.id);
    const columns = columnsFromImport(row, storedRows);

    let mapping = parseJson(row.mapping_json, {}) || {};
    if (body.mapping && typeof body.mapping === 'object') {
      mapping = normalizeMapping(body.mapping, columns.length ? columns : Object.keys(body.mapping));
    }
    const sourceLabel = body.sourceLabel === undefined
      ? row.source_label
      : (typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : '');
    const lawfulBasis = body.lawfulBasis === undefined
      ? row.lawful_basis
      : (typeof body.lawfulBasis === 'string' ? body.lawfulBasis.trim() : '');

    const nextStatus = body.mapping ? 'mapped' : (row.status === 'uploaded' ? 'mapped' : row.status);
    app.db.prepare(`
      UPDATE imports
         SET mapping_json = ?, source_label = ?, lawful_basis = ?, status = ?
       WHERE org_id = ? AND id = ?
    `).run(
      JSON.stringify(mapping),
      sourceLabel || null,
      lawfulBasis || null,
      nextStatus,
      session.orgId,
      row.id,
    );
    const next = loadImport(org, row.id);
    return detail(app.db, next);
  });

  app.post('/api/imports/:id/validate', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const row = loadImport(org, Number(request.params.id));
    if (!row) return sendError(reply, 404, 'not_found');
    if (row.status === 'rejected') return sendError(reply, 409, 'conflict');
    if (row.status === 'active') {
      const stats = statsOf(row);
      return { stats };
    }

    const result = validateImport(app.db, org, row);
    if (result.error) {
      return sendError(reply, 400, 'validation_failed', result.error);
    }
    app.db.prepare(`
      UPDATE imports SET stats_json = ?, status = 'validated', mapping_json = ?
       WHERE org_id = ? AND id = ?
    `).run(JSON.stringify(result.stats), JSON.stringify(result.mapping), session.orgId, row.id);
    return { stats: result.stats };
  });

  app.post('/api/imports/:id/activate', async (request, reply) => {
    const session = request.fcSession;
    const org = withOrg(app.db, session.orgId);
    const id = Number(request.params.id);
    if (!loadImport(org, id)) return sendError(reply, 404, 'not_found');

    const at = nowIso(app.db);
    let outcome;
    try {
      const apply = app.db.transaction(() => {
        const fresh = loadImport(org, id);
        if (!fresh) return { notFound: true };
        if (fresh.status === 'rejected') return { conflict: true };
        // Replay must not re-run mergeIncoming / inserts.
        if (fresh.status === 'active') return { stats: statsOf(fresh) };

        const fields = {};
        if (!String(fresh.lawful_basis || '').trim()) fields.lawfulBasis = 'Lawful basis is required';
        if (!String(fresh.source_label || '').trim()) fields.sourceLabel = 'Source label is required';
        if (Object.keys(fields).length) return { validation: { fields } };
        if (!loadImportRows(app.db, fresh.id).length) {
          return { validation: { message: 'No rows to activate' } };
        }

        const result = activateImport(app.db, org, session, fresh, at);
        if (result.error) return { validation: result.error };

        app.db.prepare(`
          UPDATE imports
             SET stats_json = ?, status = 'active', journey_key = 'div6-invite'
           WHERE org_id = ? AND id = ?
        `).run(JSON.stringify(result.stats), session.orgId, fresh.id);

        writeAudit(app.db, {
          orgId: session.orgId,
          actorUserId: session.userId,
          action: 'import.activate',
          entityType: 'import',
          entityId: fresh.id,
          after: {
            stats: result.stats,
            peopleCreated: result.stats.peopleCreated,
            peopleMerged: result.stats.peopleMerged,
          },
        });
        return { stats: result.stats };
      });
      outcome = apply();
    } catch (err) {
      if (uniqueConflict(err)) return sendError(reply, 409, 'conflict');
      throw err;
    }

    if (outcome.notFound) return sendError(reply, 404, 'not_found');
    if (outcome.conflict) return sendError(reply, 409, 'conflict');
    if (outcome.validation) return sendError(reply, 400, 'validation_failed', outcome.validation);
    return {
      stats: outcome.stats,
      peopleCreated: outcome.stats.peopleCreated,
      peopleMerged: outcome.stats.peopleMerged,
    };
  });
}
