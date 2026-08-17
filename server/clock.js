export function now(db) {
  if (process.env.SEED_DEMO === 'true') {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'demo_clock'").get();
    if (row) return new Date(row.value);
  }
  return new Date();
}

export function todayIso(db, tz = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now(db));
  const year = parts.find((p) => p.type === 'year').value;
  const month = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

export function endAt(appt) {
  return new Date(Date.parse(appt.start_at) + Number(appt.duration_min) * 60_000);
}

export function nowIso(db) {
  if (process.env.SEED_DEMO === 'true') {
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'demo_clock'").get();
    if (row) return row.value;
  }
  return now(db).toISOString();
}

// Shift an ISO-8601 timestamp by ms while keeping a trailing offset (demo clock is -05:00).
export function shiftIso(iso, ms) {
  const raw = String(iso);
  const offset = raw.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1] || 'Z';
  const utc = Date.parse(raw) + Number(ms);
  if (!Number.isFinite(utc)) return raw;
  if (offset === 'Z') return new Date(utc).toISOString();
  const sign = offset[0] === '-' ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  const local = new Date(utc + sign * (h * 60 + m) * 60_000);
  const p = (n) => String(n).padStart(2, '0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}${offset}`;
}
