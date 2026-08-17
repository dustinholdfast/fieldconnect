const QUIET_START = 21;
const QUIET_END = 8;

export function parseStepOffsetMs(timing) {
  const text = String(timing || '').trim();
  let m = text.match(/^\+(\d+)\s*hours?$/i);
  if (m) return Number(m[1]) * 3600_000;
  m = text.match(/^\+(\d+)\s*days?$/i);
  if (m) return Number(m[1]) * 86400_000;
  m = text.match(/^Day\s+(\d+)/i);
  if (m) return Number(m[1]) * 86400_000;
  m = text.match(/^(\d+)\s+days?\s+before/i);
  if (m) return 0;
  m = text.match(/^(\d+)\s+day\s+before/i);
  if (m) return 0;
  m = text.match(/^Quarter\s+(\d+)/i);
  if (m) return (Number(m[1]) - 1) * 90 * 86400_000;
  return 0;
}

export function parseStepHour(timing) {
  const m = String(timing || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function isQuietHour(date, tz = 'America/Chicago') {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(date));
  return hour >= QUIET_START || hour < QUIET_END;
}

export function nextOpenHour(date, tz = 'America/Chicago') {
  let cursor = new Date(date.getTime());
  for (let i = 0; i < 36; i += 1) {
    if (!isQuietHour(cursor, tz)) return cursor;
    cursor = new Date(cursor.getTime() + 3600_000);
  }
  return cursor;
}

export function scheduleAt(enrolledAt, timing, tz = 'America/Chicago') {
  const base = enrolledAt instanceof Date ? enrolledAt : new Date(enrolledAt);
  const offset = parseStepOffsetMs(timing);
  const clock = parseStepHour(timing);
  let when = new Date(base.getTime() + offset);
  if (clock) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(when);
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    when = new Date(`${y}-${mo}-${d}T${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}:00`);
  }
  return nextOpenHour(when, tz);
}

export function freqCapMs(cap) {
  const text = String(cap || '').toLowerCase();
  if (text.includes('month')) return 28 * 86400_000;
  if (text.includes('week')) return 7 * 86400_000;
  if (text.includes('day')) return 86400_000;
  return 0;
}
