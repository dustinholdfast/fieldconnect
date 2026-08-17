import { randomBytes } from 'node:crypto';
import {
  APPTS,
  CONTACTS,
  COURSES,
  IMPORTS,
  JOURNEYS,
  ORGS,
  PATHWAYS,
  STORY_BASE,
} from '../../js/data.js';
import { hashPassword } from '../password.js';

export const DEMO_CLOCK = '2026-08-27T12:00:00-05:00';
export const DEMO_TODAY = '2026-08-27';
export const DEMO_TOMORROW = '2026-08-28';

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

const ORG_META = {
  'Church of Scientology of Twin Cities': {
    slug: 'twin-cities',
    timezone: 'America/Chicago',
  },
  'Church of Scientology of Boston': {
    slug: 'boston',
    timezone: 'America/New_York',
  },
  'Church of Scientology of Seattle': {
    slug: 'seattle',
    timezone: 'America/Los_Angeles',
  },
  'Church of Scientology of Chicago': {
    slug: 'chicago',
    timezone: 'America/Chicago',
  },
  'Church of Scientology of Los Angeles': {
    slug: 'los-angeles',
    timezone: 'America/Los_Angeles',
  },
};

const LOGIN_USERS = [
  { email: 'fsm@twincities.example', password: 'demo-fsm-2026', role: 'fsm', display_name: 'D. Whitfield', initials: 'DW', active: 1 },
  { email: 'host@twincities.example', password: 'demo-host-2026', role: 'manager', display_name: 'A. Reyes', initials: 'AR', active: 1 },
  { email: 'admin@twincities.example', password: 'demo-admin-2026', role: 'admin', display_name: 'M. Okafor', initials: 'MO', active: 1 },
];

const INACTIVE_USERS = [
  { email: 'lindgren@twincities.example', role: 'fsm', display_name: 'S. Lindgren', initials: 'SL' },
  { email: 'okonjo@twincities.example', role: 'fsm', display_name: 'J. Okonjo', initials: 'JO' },
];

const CAMPAIGNS = [
  { code: 'dn-45', name: 'Dianetics #45' },
  { code: 'dn-46', name: 'Dianetics #46' },
  { code: 'dn-47', name: 'Dianetics #47' },
];

const JOURNEY_KEY_BY_LABEL = {
  'Attended, no booking': 'j1',
  'No-show recovery': 'j2',
  'Book buyer': 'j4',
  'DN Seminar buyer': 'j5',
  'Interested, unbooked': 'j6',
  'Interested but unqualified': 'j6',
};

const SUPPORTING_PEOPLE = [
  ['N.', 'Brooks', 'n.brooks@example.test'],
  ['Ada', 'Pencilton', 'ada.pencilton@example.test'],
  ['Milo', 'Cartwheel', 'milo.cartwheel@example.test'],
  ['Bea', 'Lamppost', 'bea.lamppost@example.test'],
  ['Theo', 'Paperhat', 'theo.paperhat@example.test'],
  ['Lila', 'Moonstep', 'lila.moonstep@example.test'],
  ['Gus', 'Rivetson', 'gus.rivetson@example.test'],
  ['Cora', 'Mapleton', 'cora.mapleton@example.test'],
  ['Ned', 'Buttonworth', 'ned.buttonworth@example.test'],
  ['Iris', 'Cloudwell', 'iris.cloudwell@example.test'],
  ['Pax', 'Riverview', 'pax.riverview@example.test'],
  ['June', 'Tablecloth', 'june.tablecloth@example.test'],
  ['Otis', 'Rainbarrel', 'otis.rainbarrel@example.test'],
  ['Willa', 'Inkstone', 'willa.inkstone@example.test'],
  ['Clem', 'Boardwalk', 'clem.boardwalk@example.test'],
  ['Rita', 'Softpebble', 'rita.softpebble@example.test'],
  ['Hugo', 'Lampwick', 'hugo.lampwick@example.test'],
  ['Nell', 'Copperpot', 'nell.copperpot@example.test'],
  ['Finn', 'Meadowlark', 'finn.meadowlark@example.test'],
  ['Pearl', 'Sandpiper', 'pearl.sandpiper@example.test'],
  ['Cal', 'Driftwood', 'cal.driftwood@example.test'],
  ['Esme', 'Nightingale', 'esme.nightingale@example.test'],
  ['Bert', 'Candlewick', 'bert.candlewick@example.test'],
  ['Tessa', 'Brookstone', 'tessa.brookstone@example.test'],
  ['Leo', 'Puddlejumper', 'leo.puddlejumper@example.test'],
  ['Mabel', 'Stovepipe', 'mabel.stovepipe@example.test'],
  ['Rex', 'Quiltman', 'rex.quiltman@example.test'],
  ['Daphne', 'Tidepool', 'daphne.tidepool@example.test'],
  ['Sid', 'Clocktower', 'sid.clocktower@example.test'],
  ['Greta', 'Pincushion', 'greta.pincushion@example.test'],
  ['Walt', 'Shoelace', 'walt.shoelace@example.test'],
  ['Ivy', 'Windowsill', 'ivy.windowsill@example.test'],
  ['Norm', 'Biscuit', 'norm.biscuit@example.test'],
  ['Faye', 'Lantern', 'faye.lantern@example.test'],
  ['Pete', 'Doorknob', 'pete.doorknob@example.test'],
  ['Sally', 'Teacup', 'sally.teacup@example.test'],
  ['Hank', 'Bookshelf', 'hank.bookshelf@example.test'],
  ['Clara', 'Umbrella', 'clara.umbrella@example.test'],
  ['Max', 'Clothesline', 'max.clothesline@example.test'],
  ['Ruby', 'Footbridge', 'ruby.footbridge@example.test'],
];

function splitName(name) {
  const trimmed = String(name).trim();
  const i = trimmed.lastIndexOf(' ');
  if (i === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, i), last: trimmed.slice(i + 1) };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseClockTime(label) {
  const [hm, ap] = label.trim().split(/\s+/);
  let [h, min] = hm.split(':').map(Number);
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${pad2(h)}:${pad2(min)}:00`;
}

function tzOffset(abbr) {
  // Demo clock is August 2026 (DST).
  return abbr === 'ET' ? '-04:00' : '-05:00';
}

function tzName(abbr) {
  return abbr === 'ET' ? 'America/New_York' : 'America/Chicago';
}

function parseApptWhen(when, tzAbbr) {
  const offset = tzOffset(tzAbbr);
  const tz = tzName(tzAbbr);
  if (when.startsWith('Today ')) {
    return { startAt: `${DEMO_TODAY}T${parseClockTime(when.slice(6))}${offset}`, timezone: tz };
  }
  if (when.startsWith('Tomorrow ')) {
    return { startAt: `${DEMO_TOMORROW}T${parseClockTime(when.slice(9))}${offset}`, timezone: tz };
  }
  const m = when.match(/^(\d{1,2}) (\w+) (\d{1,2}:\d{2} [AP]M)$/);
  if (!m) throw new Error(`unparsed appointment time: ${when}`);
  const month = MONTHS[m[2]];
  if (!month) throw new Error(`unparsed month: ${m[2]}`);
  return {
    startAt: `2026-${month}-${pad2(m[1])}T${parseClockTime(m[3])}${offset}`,
    timezone: tz,
  };
}

function parseHistoryDate(label) {
  const m = String(label).match(/^(\d{1,2}) (\w+)$/);
  if (!m) return `${DEMO_TODAY}T00:00:00-05:00`;
  const month = MONTHS[m[2]] || '08';
  return `2026-${month}-${pad2(m[1])}T00:00:00-05:00`;
}

function parseImportDate(label) {
  const m = String(label).match(/^(\d{1,2}) (\w+) (\d{4})$/);
  if (!m) return `${DEMO_TODAY}T00:00:00-05:00`;
  return `${m[3]}-${MONTHS[m[2]]}-${pad2(m[1])}T00:00:00-05:00`;
}

function campaignCode(eventName) {
  const m = String(eventName).match(/#(\d+)/);
  return m ? `dn-${m[1]}` : null;
}

function parseConsent(label) {
  if (!label || label === 'Opted out') return { suppressed: 1, channels: [] };
  const channels = [];
  const lower = label.toLowerCase();
  if (lower.includes('email')) channels.push('email');
  if (lower.includes('sms')) channels.push('sms');
  if (lower.includes('whatsapp')) channels.push('whatsapp');
  if (lower.includes('signal')) channels.push('signal');
  return { suppressed: 0, channels };
}

function parseIntish(value) {
  return Number(String(value).replace(/,/g, '')) || 0;
}

function upsertOrg(db, name, wave, status, metapulseMap, createdAt) {
  const meta = ORG_META[name];
  if (!meta) throw new Error(`unknown org: ${name}`);
  db.prepare(`
    INSERT INTO organizations (slug, name, wave, timezone, status, metapulse_map, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      wave = excluded.wave,
      timezone = excluded.timezone,
      status = excluded.status,
      metapulse_map = excluded.metapulse_map
  `).run(meta.slug, name, wave, meta.timezone, status.toLowerCase(), metapulseMap, createdAt);
  return db.prepare('SELECT id FROM organizations WHERE slug = ?').get(meta.slug).id;
}

function userIdByName(db, orgId, displayName) {
  const row = db.prepare('SELECT id FROM users WHERE org_id = ? AND display_name = ?').get(orgId, displayName);
  return row ? row.id : null;
}

function personIdByName(db, orgId, displayName) {
  const row = db.prepare('SELECT id FROM people WHERE org_id = ? AND display_name = ?').get(orgId, displayName);
  return row ? row.id : null;
}

function campaignIdByName(db, orgId, name) {
  const row = db.prepare('SELECT id FROM campaigns WHERE org_id = ? AND name = ?').get(orgId, name);
  return row ? row.id : null;
}

function insertPerson(db, orgId, fields, nowIso) {
  const existing = fields.email
    ? db.prepare('SELECT id FROM people WHERE org_id = ? AND email = ? AND merged_into_id IS NULL').get(orgId, fields.email)
    : db.prepare('SELECT id FROM people WHERE org_id = ? AND display_name = ?').get(orgId, fields.display_name);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO people (
      org_id, first_name, last_name, display_name, email, phone, postal_code,
      source, source_notes, stage, ruin_category, journey_key, preferred_channel,
      lawful_basis, suppressed, suppressed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    fields.first_name,
    fields.last_name,
    fields.display_name,
    fields.email ?? null,
    fields.phone ?? null,
    fields.postal_code ?? null,
    fields.source ?? null,
    fields.source_notes ?? null,
    fields.stage,
    fields.ruin_category ?? null,
    fields.journey_key ?? null,
    fields.preferred_channel ?? null,
    fields.lawful_basis ?? null,
    fields.suppressed ? 1 : 0,
    fields.suppressed_at ?? null,
    nowIso,
    nowIso,
  );
  return info.lastInsertRowid;
}

function ensureAssignment(db, orgId, personId, userId, nowIso, kind = 'fsm') {
  if (!userId) return;
  const existing = db.prepare(
    'SELECT id FROM assignments WHERE org_id = ? AND person_id = ? AND user_id = ? AND kind = ?',
  ).get(orgId, personId, userId, kind);
  if (existing) return;
  db.prepare(`
    INSERT INTO assignments (org_id, person_id, user_id, kind, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run(orgId, personId, userId, kind, nowIso);
}

function ensureAppointment(db, row) {
  const existing = db.prepare(
    'SELECT id FROM appointments WHERE org_id = ? AND person_id = ? AND start_at = ?',
  ).get(row.org_id, row.person_id, row.start_at);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO appointments (
      org_id, person_id, fsm_user_id, campaign_id, start_at, timezone,
      duration_min, status, offer_token, action_due, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.org_id,
    row.person_id,
    row.fsm_user_id,
    row.campaign_id,
    row.start_at,
    row.timezone,
    row.duration_min,
    row.status,
    row.offer_token,
    row.action_due,
    row.created_at,
  );
  return info.lastInsertRowid;
}

export async function seedDemo(db) {
  const hashes = {
    'fsm@twincities.example': await hashPassword('demo-fsm-2026'),
    'host@twincities.example': await hashPassword('demo-host-2026'),
    'admin@twincities.example': await hashPassword('demo-admin-2026'),
    'lindgren@twincities.example': await hashPassword(randomBytes(32)),
    'okonjo@twincities.example': await hashPassword(randomBytes(32)),
  };

  const apply = db.transaction(() => {
    db.prepare(`
      INSERT INTO app_meta (key, value) VALUES ('demo_clock', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(DEMO_CLOCK);

    const createdAt = DEMO_CLOCK;
    const orgIds = {};
    for (const [name, wave, , , map, status] of ORGS) {
      orgIds[ORG_META[name].slug] = upsertOrg(db, name, wave, status, map, createdAt);
    }
    const twin = orgIds['twin-cities'];

    for (const user of LOGIN_USERS) {
      db.prepare(`
        INSERT INTO users (org_id, email, password_hash, display_name, initials, role, active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(org_id, email) DO NOTHING
      `).run(twin, user.email, hashes[user.email], user.display_name, user.initials, user.role, user.active);
    }
    for (const user of INACTIVE_USERS) {
      db.prepare(`
        INSERT INTO users (org_id, email, password_hash, display_name, initials, role, active)
        VALUES (?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(org_id, email) DO NOTHING
      `).run(twin, user.email, hashes[user.email], user.display_name, user.initials, user.role);
    }

    const adminId = userIdByName(db, twin, 'M. Okafor');

    for (const campaign of CAMPAIGNS) {
      db.prepare(`
        INSERT INTO campaigns (org_id, code, name) VALUES (?, ?, ?)
        ON CONFLICT(org_id, code) DO UPDATE SET name = excluded.name
      `).run(twin, campaign.code, campaign.name);
    }

    for (const contact of CONTACTS) {
      const { first, last } = splitName(contact.name);
      const consent = parseConsent(contact.consent);
      const ruinCat = contact.ruin && contact.ruin !== '—' && contact.ruin !== 'Not yet recorded'
        ? contact.ruin.split(' — ')[0]
        : null;
      const personId = insertPerson(db, twin, {
        first_name: first,
        last_name: last,
        display_name: contact.name,
        email: contact.email,
        phone: contact.phone,
        postal_code: contact.name === 'Karen Iversen' ? '55403' : null,
        source: contact.source,
        stage: contact.stage,
        ruin_category: ruinCat,
        journey_key: JOURNEY_KEY_BY_LABEL[contact.journey] ?? null,
        preferred_channel: consent.channels[0] ?? null,
        lawful_basis: consent.suppressed ? null : 'legitimate_interest_event',
        suppressed: consent.suppressed,
        suppressed_at: consent.suppressed ? '2026-08-19T00:00:00-05:00' : null,
      }, createdAt);

      const grantedAt = createdAt;
      for (const channel of consent.channels) {
        const exists = db.prepare(
          'SELECT id FROM consent_records WHERE org_id = ? AND person_id = ? AND channel = ?',
        ).get(twin, personId, channel);
        if (!exists) {
          db.prepare(`
            INSERT INTO consent_records (org_id, person_id, channel, granted, granted_at, source)
            VALUES (?, ?, ?, 1, ?, 'seed')
          `).run(twin, personId, channel, grantedAt);
        }
      }
      if (consent.suppressed) {
        for (const channel of ['email', 'sms']) {
          const exists = db.prepare(
            'SELECT id FROM consent_records WHERE org_id = ? AND person_id = ? AND channel = ?',
          ).get(twin, personId, channel);
          if (!exists) {
            db.prepare(`
              INSERT INTO consent_records (org_id, person_id, channel, granted, granted_at, source)
              VALUES (?, ?, ?, 0, ?, 'seed')
            `).run(twin, personId, channel, grantedAt);
          }
        }
      }

      const campaignId = campaignIdByName(db, twin, contact.event);
      for (const [when, text] of contact.history) {
        const occurredAt = parseHistoryDate(when);
        const exists = db.prepare(
          'SELECT id FROM engagements WHERE org_id = ? AND person_id = ? AND occurred_at = ? AND payload_json = ?',
        ).get(twin, personId, occurredAt, JSON.stringify({ text }));
        if (!exists) {
          db.prepare(`
            INSERT INTO engagements (org_id, person_id, campaign_id, type, occurred_at, payload_json)
            VALUES (?, ?, ?, 'history', ?, ?)
          `).run(twin, personId, campaignId, occurredAt, JSON.stringify({ text }));
        }
      }

      if (contact.fsm && contact.fsm !== '—') {
        ensureAssignment(db, twin, personId, userIdByName(db, twin, contact.fsm), createdAt);
      }
    }

    const stages = ['Registered', 'Attended', 'Scheduled', 'Interested', 'Completed'];
    SUPPORTING_PEOPLE.forEach(([first, last, email], i) => {
      const display = first.endsWith('.') ? `${first} ${last}` : `${first} ${last}`;
      insertPerson(db, twin, {
        first_name: first,
        last_name: last,
        display_name: display,
        email,
        phone: `+1555010${String(1000 + i).slice(-4)}`,
        source: 'Div 6 list',
        stage: last === 'Brooks' ? 'Scheduled' : stages[i % stages.length],
        lawful_basis: 'legitimate_interest_event',
        preferred_channel: 'email',
      }, createdAt);
    });

    const whitfieldId = userIdByName(db, twin, 'D. Whitfield');
    const brooksId = personIdByName(db, twin, 'N. Brooks');
    ensureAssignment(db, twin, brooksId, whitfieldId, createdAt);

    for (const [when, tzAbbr, personName, event, fsmName, status, , actionDue] of APPTS) {
      const personId = personIdByName(db, twin, personName);
      const { startAt, timezone } = parseApptWhen(when, tzAbbr);
      const fsmUserId = userIdByName(db, twin, fsmName);
      ensureAssignment(db, twin, personId, fsmUserId, createdAt);
      ensureAppointment(db, {
        org_id: twin,
        person_id: personId,
        fsm_user_id: fsmUserId,
        campaign_id: campaignIdByName(db, twin, event),
        start_at: startAt,
        timezone,
        duration_min: 45,
        status,
        offer_token: status === 'Offered' ? randomBytes(32).toString('base64url') : null,
        action_due: actionDue && actionDue !== '—' ? actionDue : null,
        created_at: createdAt,
      });
    }

    ensureAppointment(db, {
      org_id: twin,
      person_id: brooksId,
      fsm_user_id: whitfieldId,
      campaign_id: campaignIdByName(db, twin, 'Dianetics #47'),
      start_at: '2026-08-24T10:00:00-05:00',
      timezone: 'America/Chicago',
      duration_min: 45,
      status: 'Confirmed',
      offer_token: null,
      action_due: null,
      created_at: createdAt,
    });

    db.prepare(`
      INSERT INTO products (org_id, sku, name, kind, list_price_cents, currency, active)
      VALUES (?, 'dn-book', 'Dianetics book', 'book', 2500, 'USD', 1)
      ON CONFLICT(org_id, sku) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, list_price_cents = excluded.list_price_cents
    `).run(twin);
    db.prepare(`
      INSERT INTO products (org_id, sku, name, kind, list_price_cents, currency, active)
      VALUES (?, 'dn-seminar', 'DN Seminar', 'seminar', 5000, 'USD', 1)
      ON CONFLICT(org_id, sku) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, list_price_cents = excluded.list_price_cents
    `).run(twin);

    const bookId = db.prepare('SELECT id FROM products WHERE org_id = ? AND sku = ?').get(twin, 'dn-book').id;
    const seminarId = db.prepare('SELECT id FROM products WHERE org_id = ? AND sku = ?').get(twin, 'dn-seminar').id;

    db.prepare(`
      INSERT INTO pathway_sets (org_id, version, status, approved_by, approved_at)
      VALUES (?, 1, 'approved', ?, ?)
      ON CONFLICT(org_id, version) DO UPDATE SET status = 'approved'
    `).run(twin, adminId, createdAt);
    const setId = db.prepare('SELECT id FROM pathway_sets WHERE org_id = ? AND version = 1').get(twin).id;
    if (db.prepare('SELECT COUNT(*) AS c FROM pathway_items WHERE pathway_set_id = ?').get(setId).c === 0) {
      let sort = 0;
      for (const [ruinCategory, items] of Object.entries(PATHWAYS)) {
        for (const [label, detail] of items) {
          const productId = /book/i.test(label) ? bookId : /seminar/i.test(label) ? seminarId : null;
          db.prepare(`
            INSERT INTO pathway_items (pathway_set_id, ruin_category, label, detail, product_id, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(setId, ruinCategory, label, detail, productId, sort);
          sort += 1;
        }
      }
    }

    for (const journey of JOURNEYS) {
      db.prepare(`
        INSERT INTO journeys (key, org_id, name, entry, objective, exit, enrolled, stats_json, editable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(key) DO NOTHING
      `).run(
        journey.id,
        twin,
        journey.name,
        journey.entry,
        journey.objective,
        journey.exit,
        journey.enrolled,
        JSON.stringify(Object.fromEntries(journey.stats)),
      );
      if (db.prepare('SELECT COUNT(*) AS c FROM journey_steps WHERE journey_key = ?').get(journey.id).c === 0) {
        journey.steps.forEach((step, i) => {
          db.prepare(`
            INSERT INTO journey_steps (journey_key, sort_order, timing, title, body, channel, engagement)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(journey.id, i, step[0], step[1], step[2], step[3], step[4]);
        });
      }
    }

    if (db.prepare('SELECT COUNT(*) AS c FROM training_modules WHERE org_id = ?').get(twin).c === 0) {
      let sort = 0;
      for (const [track, courses] of Object.entries(COURSES)) {
        for (const [title, blurb, , duration] of courses) {
          db.prepare(`
            INSERT INTO training_modules (org_id, track, title, blurb, duration_label, sort_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(twin, track, title, blurb, duration, sort);
          sort += 1;
        }
      }
    }

    if (db.prepare('SELECT COUNT(*) AS c FROM stories WHERE org_id = ?').get(twin).c === 0) {
      for (const [contributor, source, summary, stage, release] of STORY_BASE) {
        const personId = personIdByName(db, twin, contributor);
        db.prepare(`
          INSERT INTO stories (org_id, person_id, contributor, source, summary, stage, release, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(twin, personId, contributor, source, summary, stage, release, createdAt);
      }
    }

    const importStatus = (label) => {
      if (/rejected/i.test(label)) return 'rejected';
      if (/active/i.test(label)) return 'active';
      return 'validated';
    };
    for (const [filename, when, rows, valid, issues, statusLabel] of IMPORTS) {
      const exists = db.prepare('SELECT id FROM imports WHERE org_id = ? AND filename = ?').get(twin, filename);
      if (exists) continue;
      const status = importStatus(statusLabel);
      db.prepare(`
        INSERT INTO imports (
          org_id, filename, stored_path, uploaded_by, uploaded_at, status,
          source_label, lawful_basis, stats_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        twin,
        filename,
        `/data/files/${twin}/imports/${filename}`,
        adminId,
        parseImportDate(when),
        status,
        filename.replace(/\.(csv|xlsx)$/i, ''),
        status === 'rejected' ? null : 'legitimate_interest_event',
        JSON.stringify({
          rowsRead: parseIntish(rows),
          valid: parseIntish(valid),
          rejected: parseIntish(issues),
          reason: status === 'rejected' ? 'no lawful basis' : undefined,
        }),
      );
    }

    if (db.prepare('SELECT COUNT(*) AS c FROM availability_rules WHERE org_id = ?').get(twin).c === 0) {
      db.prepare(`
        INSERT INTO availability_rules (
          org_id, timezone, work_start, work_end, duration_min, buffer_min,
          min_notice_hours, max_per_day, weekday_mask
        ) VALUES (?, 'America/Chicago', '09:00', '19:00', 45, 15, 12, 4, 62)
      `).run(twin);
    }
  });

  apply();
}
