-- Wave 2 / Wave 3 scaffolding. Frozen columns; later PRs may ADD only.
-- Do not re-seed journeys here — those templates are seeded once in PR 2.

CREATE TABLE enrollments (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  person_id   INTEGER NOT NULL REFERENCES people(id),
  journey_key TEXT NOT NULL REFERENCES journeys(key),
  branch      TEXT,
  status      TEXT NOT NULL,
  exit_reason TEXT,
  enrolled_at TEXT NOT NULL,
  exited_at   TEXT
);

CREATE TABLE outbound_messages (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  step_id       INTEGER NOT NULL REFERENCES journey_steps(id),
  channel       TEXT NOT NULL,
  status        TEXT NOT NULL,
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT
);

CREATE TABLE calendar_connections (
  id               INTEGER PRIMARY KEY,
  org_id           INTEGER NOT NULL REFERENCES organizations(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  provider         TEXT NOT NULL CHECK (provider IN ('google','outlook')),
  status           TEXT NOT NULL,
  tokens_encrypted TEXT,
  last_sync_at     TEXT
);

CREATE TABLE training_progress (
  id           INTEGER PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  module_id    INTEGER NOT NULL REFERENCES training_modules(id),
  progress_pct INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (user_id, module_id)
);

CREATE TABLE signoffs (
  id            INTEGER PRIMARY KEY,
  org_id        INTEGER NOT NULL REFERENCES organizations(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  track         TEXT NOT NULL,
  supervisor_id INTEGER REFERENCES users(id),
  signed_at     TEXT
);

CREATE TABLE story_consents (
  id           INTEGER PRIMARY KEY,
  org_id       INTEGER NOT NULL REFERENCES organizations(id),
  story_id     INTEGER NOT NULL REFERENCES stories(id),
  channel      TEXT NOT NULL,
  granted      INTEGER NOT NULL,
  granted_at   TEXT,
  withdrawn_at TEXT
);

CREATE TABLE candidates (
  id         INTEGER PRIMARY KEY,
  org_id     INTEGER NOT NULL REFERENCES organizations(id),
  name       TEXT NOT NULL,
  source     TEXT NOT NULL,
  stage      TEXT NOT NULL CHECK (stage IN (
               'Prospect','Interested','Orient. registered','Orient. attended',
               'Qualification','Activated','First activity','Retained')),
  created_at TEXT NOT NULL
);

CREATE TABLE orientation_sessions (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  title       TEXT NOT NULL,
  session_on  TEXT NOT NULL,
  registered  INTEGER NOT NULL DEFAULT 0,
  attended    INTEGER NOT NULL DEFAULT 0,
  qualified   INTEGER NOT NULL DEFAULT 0,
  activated   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE org_memberships (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  org_id  INTEGER NOT NULL REFERENCES organizations(id),
  role    TEXT NOT NULL,
  UNIQUE (user_id, org_id)
);

CREATE TABLE public_pages (
  id          INTEGER PRIMARY KEY,
  org_id      INTEGER NOT NULL REFERENCES organizations(id),
  slug        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('register','book')),
  campaign_id INTEGER REFERENCES campaigns(id),
  UNIQUE (org_id, slug)
);
