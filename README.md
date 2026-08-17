# FieldConnect — Event → Field Conversion Platform

High-fidelity interactive SPA that faithfully recreates the FieldConnect design handoff (all 10 workspaces, Classical design system, role-based navigation, and the interactions specified in the prototype).

The Pilot runtime is a single Node.js (Fastify) process that serves the existing Classical SPA and a SQLite database. Session login is live; CRM APIs land in later work. The browser still reads `js/data.js` for screen content.

## Features implemented

- **Session auth**: cookie `fc_session` (HttpOnly, SameSite=Lax, Path=/; `Secure` only when `NODE_ENV=production`; signed with `SESSION_SECRET`), 12-hour sliding TTL on every authenticated `/api/*` request, CSRF via `X-CSRF-Token`
- **Login screen** at `/login` (no shell). Unauthenticated visits redirect to `/login?next=`. There is **no role switcher** — `state.role` comes from the session user.
- **Global shell**: fixed 244 px sidebar, role-aware nav, header with user chip from the session, MetaPulse sync status
- **Role scoping** (from `users.role` / `ROLE_SCREENS`):
  - FSM (D. Whitfield) — Dashboard, Attendee CRM (own contacts only), Scheduling, Outcome form, Training
  - Campaign manager / host (A. Reyes) — Dashboard, CRM, Scheduling, Nurture, Division 6 lists, Training, Recruitment, Success line
  - Platform admin (M. Okafor) — all ten workspaces
- **Dashboard** — KPI strip, lifecycle funnel with proportional bars, conversion-by-FSM table, needs-attention panel
- **Attendee CRM** — live search + stage filter, contact table, sticky record panel with activity history, “Open outcome form”
- **Scheduling** — stat cards, appointment queue with status colours, canonical availability + week slot grid
- **Outcome form** — full Ruin → approved pathway panel, product results with live revenue, journey assignment, consent checkboxes, “Recorded on submit” derived panel, submit confirmation
- **Nurture journeys** — selectable journey cards, step table with timing / channel / engagement, exit rules
- **Division 6 lists** — 4-step wizard (Upload → Map → Validate → Activate) + import history
- **Training library** — track chips, course cards with progress bars, qualification status rail
- **Recruitment funnel** — pipeline board (8 stages) + orientation webinar table
- **Success line** — stage cards, story table with Advance action, separate consent record
- **Platform admin** — live orgs from `GET /api/orgs` (the one cross-org metadata read), roles documentation, MetaPulse Level 1 CSV export, Level 2 disabled, last L1 export stats, audit trail from `GET /api/audit`

All sample data and copy match the original design prototype.

## Design system

Classical tokens (colours, typography, spacing, radius, component classes) are loaded from `css/classical.css`. Application layout lives in `css/app.css`. Fonts: Cormorant Garamond (headings) + Lora (body) via Google Fonts.

Layout target: desktop, min-width 1360 px (horizontal scroll on narrower viewports).

## Run with Docker

Requires Docker Compose. The app listens on port 8080.

```bash
docker compose up --build -d
```

Open **http://localhost:8080**

Health: `GET http://localhost:8080/healthz` → `{ "ok": true, "db": "ok", "jobs": "ok" }` (`jobs` is `"off"` when the in-process runner is disabled).

Stop:

```bash
docker compose down
```

## Run without Docker

Node 22+:

```bash
npm install
SEED_DEMO=true npm start
```

Then open **http://localhost:8080**. Override the port with `PORT`.

SQLite lives at `$FIELDCONNECT_DATA_DIR/fieldconnect.sqlite` (default `./data`, gitignored). Compose sets `FIELDCONNECT_DATA_DIR=/data`.

### Demo fixtures (`SEED_DEMO=true`)

Compose sets `SEED_DEMO=true`. That writes fictional Twin Cities users and sample records. These are **fixtures**, not real people.

| Email | Password | Role |
| --- | --- | --- |
| `fsm@twincities.example` | `demo-fsm-2026` | FSM |
| `host@twincities.example` | `demo-host-2026` | Host / campaign manager |
| `admin@twincities.example` | `demo-admin-2026` | Admin |

Inactive FSM rows (`lindgren@twincities.example`, `okonjo@twincities.example`) exist so seeded appointments have owners. They cannot log in — the API returns the same `401 { error: { code: "invalid_credentials" } }` as a bad password.

Password hashes are `scrypt$16384$8$1$<saltB64>$<hashB64>` (N=16384, r=8, p=1, keylen=32, 16-byte salt).

Login is rate-limited to **5 failures / 15 minutes / email+IP** in an in-memory `Map`. The limiter **resets on process restart** (including Compose `restart: unless-stopped`). A sixth failure in the window returns `429 { error: { code: "rate_limited" } }`.

Demo credentials are documented here only. The login screen does not show them, and there is no production role switcher.

With `SEED_DEMO=true`, `server/clock.js` reads `app_meta.demo_clock` (`2026-08-27T12:00:00-05:00`) instead of the wall clock.

### Production bootstrap (`SEED_DEMO=false`)

The production image does not seed demo users. Create an org and admin:

```bash
npm run migrate
node scripts/create-admin.js --org "Church of Scientology of Twin Cities" --slug twin-cities --email admin@org.example --password '…'
```

Or `npm run seed:admin -- --org "…" --slug twin-cities --email admin@org.example --password '…'`.

`npm run seed` applies the demo fixture (safe to run twice).

## Project structure

```
fieldconnect/
├── index.html
├── css/
│   ├── classical.css   # Classical design-system tokens + components
│   └── app.css         # FieldConnect shell & screen styles
├── js/
│   ├── data.js         # All sample data (contacts, journeys, pathways…)
│   ├── api.js          # fetch wrapper + CSRF header
│   ├── app.js          # Session bootstrap, rendering, interactions
│   └── screens/login.js
├── server/
│   ├── index.js        # Fastify listen, static prefixes, SPA fallback
│   ├── health.js       # GET /healthz
│   ├── auth.js         # Sessions, CSRF, login limiter
│   ├── rbac.js         # ROLE_SCREENS + route × role matrix
│   ├── routes/auth.js  # /api/auth/login|logout|me
│   ├── db.js           # SQLite open, migrate, withOrg
│   ├── clock.js        # demo_clock or wall clock
│   ├── seed.js         # npm run seed
│   ├── migrations/     # numbered SQL
│   └── fixtures/demo.js
├── scripts/
│   └── create-admin.js # SEED_DEMO=false bootstrap
├── data/               # gitignored sqlite + files
├── test/
├── Dockerfile
├── nginx.conf          # optional TLS edge example; not required to run
├── docker-compose.yml
├── package.json
└── README.md
```

## Architecture notes

The browser still runs the vanilla JS SPA (`js/app.js` + `js/data.js`). Fastify serves `/css` and `/js` as static files and returns `index.html` for other document GETs so History API routes such as `/crm/1` can refresh. Missing files under `/css`, `/js`, `/fonts`, and `/assets` return 404 (never the SPA shell). On boot the process opens SQLite, applies `server/migrations/*.sql`, and seeds when `SEED_DEMO=true`.

The client calls `GET /api/auth/me` on boot. A 401 sends the browser to `/login?next=`. After login, navigation goes to `next` or `/dashboard`, and the user chip / nav come from the session — the role switcher is not rendered. Unauthenticated `/api/*` (except login/logout) returns `401 unauthenticated`. `GET /metrics` is an admin-only stub.

An in-process job poller (`setInterval` 2s, one queued row per tick) runs when `JOBS_ENABLED` is not `false` (`npm start` / Compose). Kinds: `metapulse_l1` (Level 1 CSV of live people) and `reminders` (Booked appointments with `start_at - clock.now() ≤ 24h` become `Reminder due`). `metapulse_reconcile` is rejected until Wave 2. Failures increment `attempts` and requeue; after 3 attempts the job is `failed`. Under the frozen demo clock, retry backoff is 0 (the 2s poller spaces work); production waits `5s * 2^(attempts-1)` on the wall clock. Domain times always use `clock.now()`. `/healthz` only reads counters — it does not run jobs.

`GET /api/orgs` is the one cross-org metadata read (id, slug, name, wave, status, user/contact counts, map). It does not return people, emails, or appointments. Admin session `org_id` stays Twin Cities for every mutating route. MetaPulse Level 2 cannot be enabled in Pilot (`METAPULSE_L2_ENABLED` stays false; the admin control is disabled).

`SESSION_SECRET` signs `fc_session`. Missing in production exits the process; missing in development generates a random secret and warns once. Rotating the secret invalidates existing cookies.

`nginx.conf` is retained as an optional TLS edge example. It is not required to run the Pilot process.

Public event landing pages, registration forms, and booking pages are out of scope per the handoff.
