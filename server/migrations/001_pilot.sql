-- Clock / kv (Pilot) ------------------------------------------------------
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- seed: demo_clock = 2026-08-27T12:00:00-05:00

-- Tenant -----------------------------------------------------------------
CREATE TABLE organizations (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  wave          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'America/Chicago',
  status        TEXT NOT NULL,
  metapulse_map TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE users (
  id             INTEGER PRIMARY KEY,
  org_id         INTEGER NOT NULL REFERENCES organizations(id),
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  initials       TEXT NOT NULL,
  role           TEXT NOT NULL,
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, email)
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  csrf_token   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT
);

-- First-class records ------------------------------------------------------
CREATE TABLE people (
  id              INTEGER PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  postal_code     TEXT,
  source          TEXT,
  source_notes    TEXT,
  stage           TEXT NOT NULL,
  ruin_category   TEXT,
  journey_key     TEXT,
  preferred_channel TEXT,
  lawful_basis    TEXT,
  suppressed      INTEGER NOT NULL DEFAULT 0,
  suppressed_at   TEXT,
  merged_into_id  INTEGER REFERENCES people(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_people_org_phone ON people(org_id, phone);
CREATE INDEX idx_people_org_stage ON people(org_id, stage);
CREATE UNIQUE INDEX idx_people_org_email_live
  ON people(org_id, email)
  WHERE email IS NOT NULL AND merged_into_id IS NULL;

CREATE TABLE consent_records (
  id           INTEGER PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  person_id    INTEGER NOT NULL REFERENCES people(id),
  channel      TEXT NOT NULL,
  granted      INTEGER NOT NULL,
  granted_at   TEXT,
  withdrawn_at TEXT,
  source       TEXT NOT NULL
);

CREATE TABLE campaigns (
  id         INTEGER PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES organizations(id),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  starts_at  TEXT,
  UNIQUE (org_id, code)
);

CREATE TABLE engagements (
  id               INTEGER PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id),
  person_id        INTEGER NOT NULL REFERENCES people(id),
  campaign_id      INTEGER REFERENCES campaigns(id),
  type             TEXT NOT NULL,
  occurred_at      TEXT NOT NULL,
  minutes_attended INTEGER,
  payload_json     TEXT,
  created_by       INTEGER REFERENCES users(id)
);
CREATE INDEX idx_eng_person ON engagements(org_id, person_id, occurred_at);

CREATE TABLE assignments (
  id         INTEGER PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES organizations(id),
  person_id  INTEGER NOT NULL REFERENCES people(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  kind       TEXT NOT NULL,
  status     TEXT NOT NULL,
  due_at     TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE appointments (
  id                   INTEGER PRIMARY KEY,
  org_id               INTEGER NOT NULL REFERENCES organizations(id),
  person_id            INTEGER NOT NULL REFERENCES people(id),
  fsm_user_id          INTEGER REFERENCES users(id),
  campaign_id          INTEGER REFERENCES campaigns(id),
  start_at             TEXT NOT NULL,
  timezone             TEXT NOT NULL,
  duration_min         INTEGER NOT NULL DEFAULT 45,
  status               TEXT NOT NULL CHECK (status IN (
                         'Offered','Booked','Confirmed','Reminder due',
                         'Partial','No-show','Completed','Cancelled')),
  offer_token          TEXT UNIQUE,
  action_due           TEXT,
  actual_duration_min  INTEGER,
  partial_reason       TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX idx_appt_org_start ON appointments(org_id, start_at);

CREATE TABLE availability_rules (
  id               INTEGER PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id),
  user_id          INTEGER REFERENCES users(id),
  timezone         TEXT NOT NULL,
  work_start       TEXT NOT NULL,
  work_end         TEXT NOT NULL,
  duration_min     INTEGER NOT NULL,
  buffer_min       INTEGER NOT NULL,
  min_notice_hours INTEGER NOT NULL,
  max_per_day      INTEGER NOT NULL,
  weekday_mask     INTEGER NOT NULL DEFAULT 62
);

CREATE TABLE products (
  id               INTEGER PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id),
  sku              TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL,
  list_price_cents INTEGER NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  active           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, sku)
);

CREATE TABLE pathway_sets (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  version     INTEGER NOT NULL,
  status      TEXT NOT NULL,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  UNIQUE (org_id, version)
);

CREATE TABLE pathway_items (
  id             INTEGER PRIMARY KEY,
  pathway_set_id INTEGER NOT NULL REFERENCES pathway_sets(id),
  ruin_category  TEXT NOT NULL,
  label          TEXT NOT NULL,
  detail         TEXT,
  product_id     INTEGER REFERENCES products(id),
  sort_order     INTEGER NOT NULL
);

CREATE TABLE outcomes (
  id              INTEGER PRIMARY KEY,
  org_id          INTEGER NOT NULL REFERENCES organizations(id),
  appointment_id  INTEGER NOT NULL UNIQUE REFERENCES appointments(id),
  person_id       INTEGER NOT NULL REFERENCES people(id),
  fsm_user_id     INTEGER NOT NULL REFERENCES users(id),
  delivered       TEXT NOT NULL,
  duration_min    INTEGER,
  partial_reason  TEXT,
  result          TEXT,
  channel         TEXT,
  ruin_category   TEXT,
  desired         TEXT,
  ruin_notes      TEXT,
  pathway_label   TEXT,
  objection       TEXT,
  story_signal    TEXT,
  next_action     TEXT,
  next_due        TEXT,
  client_id       TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL
);
-- outcomes.partial_reason is unused in Pilot. Partial interviews write
-- appointments.partial_reason / actual_duration_min and do not insert here.

CREATE TABLE outcome_line_items (
  id               INTEGER PRIMARY KEY,
  outcome_id       INTEGER NOT NULL REFERENCES outcomes(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty              INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  list_price_cents INTEGER NOT NULL,
  override_reason  TEXT
);

CREATE TABLE imports (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  filename      TEXT NOT NULL,
  stored_path   TEXT NOT NULL,
  uploaded_by   INTEGER NOT NULL REFERENCES users(id),
  uploaded_at   TEXT NOT NULL,
  status        TEXT NOT NULL,
  source_label  TEXT,
  lawful_basis  TEXT,
  mapping_json  TEXT,
  stats_json    TEXT,
  journey_key   TEXT
);

CREATE TABLE import_rows (
  id              INTEGER PRIMARY KEY,
  import_id       INTEGER NOT NULL REFERENCES imports(id),
  row_num         INTEGER NOT NULL,
  raw_json        TEXT NOT NULL,
  disposition     TEXT,
  match_person_id INTEGER REFERENCES people(id),
  error           TEXT
);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  run_after   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE exports (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  job_id      INTEGER REFERENCES jobs(id),
  kind        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  row_count   INTEGER,
  created_at  TEXT NOT NULL
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  actor_user_id INTEGER REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  before_json   TEXT,
  after_json    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE outcome_submissions (
  client_id      TEXT PRIMARY KEY,
  org_id         INTEGER NOT NULL REFERENCES organizations(id),
  appointment_id INTEGER NOT NULL,
  status_code    INTEGER NOT NULL,
  response_json  TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE journeys (
  key         TEXT PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  name        TEXT NOT NULL,
  entry       TEXT NOT NULL,
  objective   TEXT NOT NULL,
  exit        TEXT NOT NULL,
  enrolled    TEXT,
  stats_json  TEXT,
  editable    INTEGER NOT NULL DEFAULT 0,
  quiet_start TEXT NOT NULL DEFAULT '21:00',
  quiet_end   TEXT NOT NULL DEFAULT '08:00',
  freq_cap    TEXT
);

CREATE TABLE journey_steps (
  id          INTEGER PRIMARY KEY,
  journey_key TEXT NOT NULL REFERENCES journeys(key),
  sort_order  INTEGER NOT NULL,
  timing      TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  channel     TEXT NOT NULL,
  engagement  TEXT
);

CREATE TABLE stories (
  id           INTEGER PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  person_id    INTEGER REFERENCES people(id),
  contributor  TEXT NOT NULL,
  source       TEXT NOT NULL,
  summary      TEXT NOT NULL,
  stage        TEXT NOT NULL CHECK (stage IN (
                 'Submitted','Screened','Interview requested','Recorded',
                 'Drafted','Consent pending','Approved','Published')),
  release      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE training_modules (
  id             INTEGER PRIMARY KEY,
  org_id         INTEGER NOT NULL REFERENCES organizations(id),
  track          TEXT NOT NULL,
  title          TEXT NOT NULL,
  blurb          TEXT NOT NULL,
  duration_label TEXT NOT NULL,
  sort_order     INTEGER NOT NULL
);

CREATE TABLE schema_migrations (
  id  INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);
