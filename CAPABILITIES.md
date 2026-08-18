# FieldConnect — Capabilities

FieldConnect is an event-to-field conversion platform. It takes people who attend a public event, walks them through a consultation, records the outcome, and keeps them on a nurture path until they book, buy, or opt out.

The live product is a single Node.js process (Fastify + SQLite) serving a Classical desktop SPA. Pilot, Wave 2, and Wave 3 are all implemented. This file describes what the software can do today.

Demo clock (when `SEED_DEMO=true`) is frozen at **27 Aug 2026, 12:00 America/Chicago**.

---

## Who can sign in

| Role | What they can do |
| --- | --- |
| **Field Staff Member (FSM)** | Own assigned contacts, own appointments, outcome form, training. Cannot import lists, edit journeys, or publish stories. |
| **Campaign manager / host** | Church-wide CRM, scheduling, nurture, Division 6 imports, training, recruitment, success line. Cannot submit outcome forms or impersonate an FSM. |
| **Platform administrator** | All ten workspaces, org metadata, MetaPulse export and Level 2/3 toggle, audit trail. |
| **Read-only executive** | Dashboard only. No creates, edits, or imports. Can switch among authorized Churches. |

Role comes from the signed-in user. There is no in-app role switcher.

**Demo logins** (`SEED_DEMO=true`):

| Email | Password | Role |
| --- | --- | --- |
| `fsm@twincities.example` | `demo-fsm-2026` | FSM (D. Whitfield) |
| `host@twincities.example` | `demo-host-2026` | Host (A. Reyes) |
| `admin@twincities.example` | `demo-admin-2026` | Admin (M. Okafor) |
| `exec@twincities.example` | `demo-exec-2026` | Executive (L. Hart) |

Hats listed in Admin but **not** login targets: Church administrator, Field disseminator, Trainer / qual supervisor, Success-line staff.

---

## Screens

### 1. Dashboard

- KPI strip and lifecycle funnel (registered → attended → scheduled → completed).
- Conversion-by-FSM table.
- Needs-attention inbox: unconfirmed appointments in the next 24 hours, outcome overdue, follow-up overdue.
- FSM view is limited to their own rows; manager/admin/executive see the Church.

### 2. Attendee CRM

- Search by name, email, or phone digits; filter by stage.
- Create and edit people (host/admin). Email or phone required.
- Assign an FSM. Merge duplicate records (host/admin).
- Sticky record panel: stage, consent, journey, event, activity history.
- **Send link** creates an Offered appointment and a copyable `/scheduling?offer=…` URL. Blocked if the person is globally suppressed or the assigned FSM is routing-gated.
- FSM sees only assigned contacts.

### 3. Scheduling

- Appointment queue with status color (Offered, Booked, Confirmed, Reminder due, Partial, Completed, No-show, Cancelled).
- Week grid of free / booked / blocked slots. Canonical rules: 09:00–19:00, 45 minutes, 15-minute buffer, 12-hour minimum notice, max 4 per day, Monday–Saturday.
- Book a free slot by searching a person (and picking an FSM if you are a host/admin).
- Offer panel: copy URL, mark booked, or cancel.
- **Calendar demo connect** (Google or Outlook). A connected calendar blocks Fri 28 Aug 15:00–16:00 CT. No real OAuth secrets.
- Booking and send-link are withheld until the FSM’s track is complete and a supervisor has signed off (`409 routing_gated`).

### 4. Outcome form (FSM only)

- Progressive form: delivered yes / no / partial.
- Ruin category → approved pathway (not free-typed).
- Product line items from the priced catalog, with override reason when the unit price differs.
- Consent checkboxes (follow-up, testimonial, public story).
- Offline queue in the browser; flushes when the network is back.
- Idempotent submit: `Idempotency-Key` must equal `clientId`. Replay returns the original response.
- Partial interview writes appointment state only (not an outcomes row) so the FSM can finish later.
- On a completed outcome the person is enrolled on the assigned journey (`j2`–`j6`).

### 5. Nurture journeys

Seven locked templates:

| Key | Journey |
| --- | --- |
| `j1` | Attended, no booking (auto-enrolled after 5 days if still unbooked) |
| `j2` | No-show recovery |
| `j3` | Completed, no book |
| `j4` | Book buyer |
| `j5` | DN Seminar buyer |
| `j6` | Interested but unqualified |
| `j7` | Remaining seeded template |

- Outcomes enroll `j2`–`j6`. A tick job enrolls `j1`.
- Steps queue as **local outbound** (no SendGrid, Twilio, or other vendor).
- Quiet hours 21:00–08:00 local; frequency caps hold extra sends.
- Immediate opt-out / global suppression stops further messages.
- Booking exits `j1`. Live enrolled / sent / exited counts show on the journey cards.

### 6. Division 6 lists (import)

Four-step wizard: **Upload → Map → Validate → Activate**.

- CSV only, max 5 MB / 2,000 rows. XLSX is rejected.
- **Download template** (`fieldconnect-import-template.csv`) with columns that map automatically: `first_name`, `last_name`, `email`, `phone`, `postal_code`, `source_notes`, `tag`. Email is the match key.
- Validate reports valid, duplicate, suppressed, and rejected rows.
- Activate requires a source label and a lawful basis (legitimate interest or consent). Activation is irreversible for that batch.
- Duplicates merge into the existing live person. Globally suppressed people stay suppressed.
- Import history lists file, date, row counts, and status.

### 7. Training library

- Tracks and modules (title, blurb, duration). No lesson video.
- Mark a module complete. Progress counts toward the FSM track.
- Managers/admins can sign off an FSM.
- Appointment routing stays withheld until the FSM track is complete **and** signed off.
- Whitfield is seeded complete + signed so demo booking works. Lindgren is the gated example.

### 8. Recruitment

- Eight-stage field-activation board.
- Advance a candidate, or drag a card onto another column. Stage persists.
- Orientation webinar table (registered / attended / qualified / activated).

### 9. Success line (stories)

- Pipeline from Submitted through Published.
- Advance stage by stage. **Publish requires at least one active channel consent** (newsletter, social, training, website).
- Grant or withdraw consent per story. Withdrawing the last active channel unpublishes to Approved.
- Consent is stored separately from the story text.

### 10. Platform admin

- Organizations table (id, slug, name, wave, status, user/contact counts, MetaPulse map). No people or emails on this read.
- Roles documentation.
- MetaPulse Level 1: export now → downloadable CSV of live people.
- MetaPulse Level 2: activate a **local** API adapter (JSON batch on disk). No vendor SDK.
- MetaPulse Level 3: when L2 is live, nightly reconcile is scheduled and a reconcile job can run.
- Recent audit trail (append-only; ruin notes are stripped).

---

## Public pages (no login)

| URL | Purpose |
| --- | --- |
| `/r/dn-45` | Register for Dianetics #45 |
| `/r/dn-45-book` | Book a consultation slot |

- Name + email or phone. Register creates a person at stage Registered.
- Book picks a free slot and assigns the Church’s first active FSM (subject to the routing gate).
- Slot grid exposes free / booked / blocked only — no attendee names.

Internal offer URLs (`/scheduling?offer=…`) still require a signed-in host or FSM.

---

## Organizations

- Tenant data is scoped by `org_id`. A Twin Cities session cannot read Boston people.
- Admin belongs to Twin Cities plus Boston, Seattle, Chicago, and LA. The sidebar switcher appears when a user has more than one membership.
- Boston / Seattle / Chicago / LA are live enough to switch into and still have **zero people**.
- Host and FSM stay on Twin Cities only. Executive can switch Twin Cities ↔ Boston.

---

## Automation and jobs

An in-process poller (every 2 seconds when `JOBS_ENABLED` is not `false`) runs:

| Job | What it does |
| --- | --- |
| Reminders | Booked appointments with start ≤ 24 hours become “Reminder due” |
| Journey tick | Enroll attended-unbooked people on `j1`; send due local outbound |
| MetaPulse L1 | Write the Level 1 CSV |
| MetaPulse reconcile | Push a local L2 batch when the adapter is live |

Failed jobs retry (max 3 attempts). `/healthz` only reads counters; it does not run jobs.

---

## Security and tenancy

- Session cookie `fc_session`: HttpOnly, SameSite=Lax, signed with `SESSION_SECRET`, 12-hour sliding TTL. `Secure` only in production.
- CSRF on mutating `/api/*` via `X-CSRF-Token`.
- Login rate limit: 5 failures / 15 minutes / email+IP (in memory; resets on process restart).
- Passwords: scrypt. Inactive users get the same `401 invalid_credentials` as a bad password.
- Content-Security-Policy, nosniff, SAMEORIGIN, strict-origin-when-cross-origin on every response.
- Self-hosted fonts. No Google Fonts. Demo emails/phones are not shipped in the browser JS bundle.
- Audit log is append-only.

---

## What this software does not do

These are intentional gaps, not missing screens:

- Real Google / Outlook OAuth (calendar is a demo connect).
- Real email or SMS delivery (outbound is a local ledger).
- Vendor MetaPulse API (L2/L3 write local files).
- Extra hats as logins.
- Populated Boston / Seattle / Chicago / LA contact books.
- XLSX import, SSO / SAML, password-reset mail, Postgres.

---

## How to run it

```bash
# From this directory, Node 22+
SEED_DEMO=true npm start
```

Default port is **8080**. Override with `PORT`. On this host the Docker copy is often published on **8083** because 8080 is Heimdall.

Health: `GET /healthz` → `{ "ok": true, "db": "ok", "jobs": "ok" }` (`jobs` is `"off"` when the runner is disabled).
