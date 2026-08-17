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
