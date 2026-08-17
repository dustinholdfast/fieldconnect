import { write as writeAudit } from '../audit.js';
import { now, nowIso } from '../clock.js';
import { tickOrg } from '../journeys/engine.js';
import { writeLevel1Csv } from '../metapulse/level1.js';
import { reconcileOrg } from '../metapulse/reconcile.js';

export const MAX_ATTEMPTS = 3;
export const KIND_METAPULSE_L1 = 'metapulse_l1';
export const KIND_REMINDERS = 'reminders';
export const KIND_RECONCILE = 'metapulse_reconcile';
export const KIND_JOURNEY = 'journey_tick';

const REMINDER_MS = 24 * 60 * 60 * 1000;
const REMINDER_REPEAT_MS = 60_000;

let timer = null;
let started = false;
let runnerDataDir = null;

// Failures increment attempts. After MAX_ATTEMPTS the job is `failed`.
// Demo clock is frozen, so backoff is 0 there; production waits
// 5s * 2^(attempts-1) on the wall clock. Domain times use clock.now().
export function backoffMs(attempts) {
  if (process.env.SEED_DEMO === 'true') return 0;
  return 5000 * (2 ** Math.max(0, attempts - 1));
}

export function enqueue(db, { orgId, kind, payload = {}, runAfter } = {}) {
  if (orgId == null) throw new Error('enqueue requires orgId');
  if (!kind) throw new Error('enqueue requires kind');
  const at = nowIso(db);
  const info = db.prepare(`
    INSERT INTO jobs (org_id, kind, status, payload_json, run_after, attempts, created_at)
    VALUES (?, ?, 'queued', ?, ?, 0, ?)
  `).run(orgId, kind, JSON.stringify(payload ?? {}), runAfter || new Date().toISOString(), at);
  return Number(info.lastInsertRowid);
}

function parsePayload(raw) {
  if (raw == null || raw === '') return {};
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function pickDueJob(db) {
  const wall = Date.now();
  const queued = db.prepare(`
    SELECT * FROM jobs WHERE status = 'queued' ORDER BY id ASC
  `).all();
  return queued.find((job) => {
    const due = Date.parse(job.run_after);
    return Number.isFinite(due) ? due <= wall : true;
  }) || null;
}

function markRunning(db, job) {
  db.prepare(`
    UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id = ?
  `).run(job.id);
  job.attempts += 1;
  job.status = 'running';
}

function markDone(db, job, result) {
  db.prepare(`
    UPDATE jobs SET status = 'done', result_json = ?, finished_at = ? WHERE id = ?
  `).run(JSON.stringify(result ?? {}), nowIso(db), job.id);
}

function markRetryOrFail(db, job, err) {
  const message = err && err.message ? String(err.message) : String(err);
  const result = { error: message };
  if (job.attempts >= MAX_ATTEMPTS) {
    db.prepare(`
      UPDATE jobs SET status = 'failed', result_json = ?, finished_at = ? WHERE id = ?
    `).run(JSON.stringify(result), nowIso(db), job.id);
    return 'failed';
  }
  const next = new Date(Date.now() + backoffMs(job.attempts)).toISOString();
  db.prepare(`
    UPDATE jobs SET status = 'queued', result_json = ?, run_after = ? WHERE id = ?
  `).run(JSON.stringify(result), next, job.id);
  return 'queued';
}

function handleReminders(db, job) {
  const nowMs = now(db).getTime();
  const rows = db.prepare(`
    SELECT id, person_id, campaign_id, start_at, status
      FROM appointments
     WHERE org_id = ? AND status = 'Booked'
  `).all(job.org_id);

  const due = rows.filter((row) => {
    const start = Date.parse(row.start_at);
    if (!Number.isFinite(start)) return false;
    return start - nowMs <= REMINDER_MS;
  });

  const at = nowIso(db);
  const apply = db.transaction(() => {
    for (const row of due) {
      db.prepare(`
        UPDATE appointments
           SET status = 'Reminder due', action_due = 'Send 24 h reminder'
         WHERE org_id = ? AND id = ? AND status = 'Booked'
      `).run(job.org_id, row.id);
      db.prepare(`
        INSERT INTO engagements (
          org_id, person_id, campaign_id, type, occurred_at, payload_json
        ) VALUES (?, ?, ?, 'reminder_due', ?, ?)
      `).run(
        job.org_id,
        row.person_id,
        row.campaign_id,
        at,
        JSON.stringify({ appointmentId: row.id }),
      );
    }
  });
  apply();
  return { flipped: due.length };
}

function handleMetapulseL1(db, job, dataDir) {
  const payload = parsePayload(job.payload_json);
  const written = writeLevel1Csv(db, {
    orgId: job.org_id,
    dataDir,
    jobId: job.id,
  });
  writeAudit(db, {
    orgId: job.org_id,
    actorUserId: payload.actorUserId ?? null,
    action: 'metapulse.export',
    entityType: 'export',
    entityId: written.exportId,
    after: {
      rowCount: written.rowCount,
      skipped: written.skipped,
      filename: written.filename,
    },
  });
  return written;
}

function handleJob(db, job, dataDir) {
  if (job.kind === KIND_METAPULSE_L1 || job.kind === 'metapulse_export') {
    return handleMetapulseL1(db, job, dataDir);
  }
  if (job.kind === KIND_REMINDERS) {
    return handleReminders(db, job);
  }
  if (job.kind === KIND_JOURNEY) {
    return tickOrg(db, job.org_id);
  }
  if (job.kind === KIND_RECONCILE) {
    return reconcileOrg(db, { orgId: job.org_id, dataDir });
  }
  throw new Error(`unknown job kind: ${job.kind}`);
}

export function runOnce(db, { dataDir } = {}) {
  const job = pickDueJob(db);
  if (!job) return null;
  markRunning(db, job);
  try {
    const result = handleJob(db, job, dataDir || runnerDataDir);
    markDone(db, job, result);
    if (job.kind === KIND_REMINDERS || job.kind === KIND_JOURNEY) {
      enqueue(db, {
        orgId: job.org_id,
        kind: job.kind,
        runAfter: new Date(Date.now() + REMINDER_REPEAT_MS).toISOString(),
      });
    }
    return { id: job.id, kind: job.kind, status: 'done', result };
  } catch (err) {
    const status = markRetryOrFail(db, job, err);
    return { id: job.id, kind: job.kind, status, error: err };
  }
}

function ensureKind(db, orgId, kind) {
  const pending = db.prepare(`
    SELECT id FROM jobs
     WHERE org_id = ? AND kind = ? AND status IN ('queued', 'running')
     LIMIT 1
  `).get(orgId, kind);
  if (!pending) enqueue(db, { orgId, kind });
}

export function ensureReminderJobs(db) {
  const orgs = db.prepare(`
    SELECT id FROM organizations WHERE lower(status) = 'live'
  `).all();
  for (const org of orgs) {
    ensureKind(db, org.id, KIND_REMINDERS);
    ensureKind(db, org.id, KIND_JOURNEY);
  }
}

export function startRunner(db, { intervalMs = 2000, dataDir } = {}) {
  if (timer) return;
  started = true;
  runnerDataDir = dataDir || null;
  const tick = () => {
    try {
      ensureReminderJobs(db);
      runOnce(db, { dataDir: runnerDataDir });
    } catch {
      // Keep the interval alive; the next tick retries.
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  runnerDataDir = null;
}

export function jobsHealth(db, enabled) {
  if (!enabled && !started) return 'off';
  const failed = db.prepare(`
    SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed' AND attempts >= ?
  `).get(MAX_ATTEMPTS).c;
  return failed > 0 ? 'degraded' : 'ok';
}
