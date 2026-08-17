# FieldConnect — Event → Field Conversion Platform

High-fidelity interactive SPA that faithfully recreates the FieldConnect design handoff (all 10 workspaces, Classical design system, role-based navigation, and the interactions specified in the prototype).

The Pilot runtime is a single Node.js (Fastify) process that serves the existing Classical SPA and a SQLite database. Login and CRM APIs land in later work. The browser still reads `js/data.js`.

## Features implemented

- **Global shell**: fixed 244 px sidebar, role-aware nav, header with role switcher + user chip, MetaPulse sync status
- **Role scoping**:
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
- **Platform admin** — organizations table, roles & permissions, MetaPulse Level 1/2/3 panel with live adapter toggle, reconciliation stats, audit trail

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

Health: `GET http://localhost:8080/healthz` → `{ "ok": true, "db": "ok" }`.

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

Inactive FSM rows (`lindgren@twincities.example`, `okonjo@twincities.example`) exist so seeded appointments have owners. They cannot log in (PR 3 treats them like a bad password).

Password hashes are `scrypt$16384$8$1$<saltB64>$<hashB64>` (N=16384, r=8, p=1, keylen=32, 16-byte salt).

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
│   └── app.js          # State, rendering, interactions
├── server/
│   ├── index.js        # Fastify listen, static prefixes, SPA fallback
│   ├── health.js       # GET /healthz
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

`nginx.conf` is retained as an optional TLS edge example. It is not required to run the Pilot process.

Public event landing pages, registration forms, and booking pages are out of scope per the handoff.
