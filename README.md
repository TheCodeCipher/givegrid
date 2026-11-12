# GiveGrid

**Connecting available resources with verified community needs.**

Course: Full Stack Development · Team: Tarun Das and Arkodyuti Bhattacharya

Donors (people, offices, hotels, event organisers) list usable physical goods they no longer need.
Verified NGOs post what they need, see ranked matches and reserve a quantity. One donation can be
split across several NGOs.

## The hard requirement

> If two NGOs claim the same donation at the same moment, a naive version would give both of them
> the stock and allocate more than the donor offered.

GiveGrid covers all three kinds of hard requirement from the course brief:

| Kind | In GiveGrid | Where to look |
|---|---|---|
| Concurrency | Two simultaneous 70-chair claims on 100 chairs: exactly one wins, 30 remain | `backend/src/services/claimService.js` |
| Multi-row transaction | Donation counter + need counter + allocation row + history event commit or roll back together | `backend/src/utils/withTransaction.js` |
| Append-only history | `donation_events` cannot be updated, deleted or truncated by the application's database role | `database/migrations/002_...sql` |

Policy when the full amount is not available: a **counter-proposal**. The server answers `409` with the
quantity that can be reserved right now. Nothing is held. To accept, the NGO sends a new claim for that
quantity and every check runs again.

A successful claim is a **48-hour hold**. If the NGO does not confirm pickup arrangements in time, a
background worker releases the quantity, exactly once.

## Stack

React (Vite) · Node.js + Express · PostgreSQL (`pg` driver, hand-written SQL) · Jest + Supertest · Postman · Git/GitHub

## Repository layout

```text
givegrid/
├── backend/
│   ├── src/            app.js, server.js, config/, routes/, controllers/, services/, middleware/, validators/, utils/
│   ├── scripts/        migrate.js, seed.js, seedLarge.js
│   └── tests/          concurrency/ and integration/ (Jest + Supertest)
├── frontend/           React app (src/api, components, layouts, pages, styles)
├── database/
│   ├── setup/          one-time roles + databases
│   ├── migrations/     001 schema, 002 append-only + privileges, 003 indexes
│   ├── seeds/          categories
│   └── diagrams/erd.md
└── docs/               api/, project/, decisions/, testing/, screenshots/
```

## Setup (fresh clone)

You need Node.js 22 (20.19 or newer also works) and PostgreSQL 14 or newer. Built and tested on Node 22 and PostgreSQL 16.

**1. Create the two database roles and two databases** (once, as the PostgreSQL superuser).
Open `database/setup/create_roles_and_databases.sql`, replace both `CHANGE_ME` passwords, then:

```bash
psql -U postgres -f database/setup/create_roles_and_databases.sql
```

**2. Create your `.env` files** (never committed):

```bash
cp .env.example .env                     # fill in the same passwords and a JWT secret
cp frontend/.env.example frontend/.env
```

**3. Backend**

```bash
cd backend
npm install
npm run migrate      # creates the tables in givegrid_dev
npm run seed         # categories + 3 demo accounts (safe to repeat)
npm run dev          # http://localhost:5000
```

You should see `Server running on port 5000` and `Database connected successfully`.
Check http://localhost:5000/api/health and http://localhost:5000/api/health/db.

**4. Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

**Demo logins** (password `password123`): `admin@givegrid.local`, `donor@givegrid.local`, `ngo@givegrid.local`

### Other commands (run inside `backend/`)

| Command | What it does |
|---|---|
| `npm test` | Migrates the **test** database, then runs all 56 tests |
| `npx jest --runInBand tests/concurrency` | Only the race-condition tests |
| `npm run seed:large` | **Empties the dev database** and loads 11,176 deterministic rows |
| `npm run migrate` / `npm run migrate:test` | Apply new migrations (already-applied files are skipped) |

## How the claim transaction works

```text
BEGIN
  SELECT donation ... FOR UPDATE        -- a competing claim now waits here
  SELECT need ... FOR UPDATE
  check: NGO verified, owns the need, both open, same category and unit
  max = min(donation.available_quantity, need.remaining_quantity)   -- fresh, locked values
  if requested > max  ->  ROLLBACK, reply 409 with counter_proposal = max   (nothing written)
  UPDATE donations  SET available_quantity = available_quantity - requested
  UPDATE needs      SET remaining_quantity = remaining_quantity - requested
  INSERT allocation (status HELD, expires_at = now() + 48 hours)
  INSERT donation_events (CLAIM_HELD, next seq)
COMMIT
```

Lock order is the same everywhere (claim, confirm, cancel, pickup, expiry):
**donation → need → allocation**. A single order means two transactions can never wait on each
other in a circle (no deadlock).

## How history is made append-only

1. **Privileges.** The app connects as `givegrid_app`, which has only `SELECT` and `INSERT` on `donation_events`.
2. **Trigger.** `BEFORE UPDATE OR DELETE` raises an exception, so even the table owner is stopped.
3. **`UNIQUE (donation_id, seq)`.** Two events can never share a sequence number.

Evidence, run with `psql` as the application role:

```text
givegrid_dev=> UPDATE donation_events SET action = 'CLAIM_CANCELLED' WHERE id = 1;
ERROR:  permission denied for table donation_events
givegrid_dev=> DELETE FROM donation_events WHERE id = 1;
ERROR:  permission denied for table donation_events
givegrid_dev=> TRUNCATE donation_events;
ERROR:  permission denied for table donation_events
-- and as the table owner:
ERROR:  donation_events is append-only: DELETE is not allowed
```

## Tests

56 automated tests (Jest + Supertest) run against a real PostgreSQL test database through the real API.
Full list and results: [`docs/testing/test-evidence.md`](docs/testing/test-evidence.md).

| Test | Result |
|---|---|
| Two concurrent 70-chair claims on 100 | 1 success, 1 conflict (offered 30), 70 allocated, 30 remain |
| 100 concurrent claims of 2 on 100 units (3 runs) | exactly 50 succeed, 50 conflicts, 0 left, no 500s |
| Two NGOs accept the same counter-offer of 30 | exactly one gets it |
| Split 40 + 40 + 20 (in sequence and concurrently) | all succeed, 0 left, a fourth claim is refused |
| Expiry worker vs a new claim; five expiry runs at once | released exactly once, never over-allocated |
| Cancel vs pickup at the same moment | exactly one wins; stock never returns after pickup |
| Failure injected halfway through a claim | nothing committed |
| App role tries UPDATE / DELETE / TRUNCATE on history | rejected by PostgreSQL |

Removing the two `FOR UPDATE` clauses makes 4 of the 9 concurrency tests fail, which shows the tests
really detect the race.

## Dataset and query plans

`npm run seed:large` loads **11,176 rows** (401 users, 200 NGOs, 11 categories, 2,500 donations,
2,500 needs, 800 allocations, 4,764 events). Eight indexes were added, each for a named query;
plans before and after are in [`docs/testing/query-plans.md`](docs/testing/query-plans.md).
Measured on this dataset only; we make no claim beyond it.

## API summary

Full reference: [`docs/api/api.md`](docs/api/api.md) · Postman: `docs/api/GiveGrid.postman_collection.json`

```text
POST  /api/auth/register · /api/auth/login        GET /api/auth/me
POST  /api/ngos            GET /api/ngos/me
GET   /api/admin/ngos      PATCH /api/admin/ngos/:id/verification
POST  /api/donations       GET /api/donations · /:id · /:id/events · /:id/matching-needs
PATCH /api/donations/:id   POST /api/donations/:id/close
POST  /api/needs           GET /api/needs · /:id      PATCH /api/needs/:id   POST /api/needs/:id/close
GET   /api/matches/:needId
POST  /api/donations/:donationId/claims            (also used to accept a counter-proposal)
GET   /api/claims
POST  /api/claims/:claimId/confirm · cancel · pickup · deliver · receipt
```

Status codes: `400` invalid input · `401` not logged in · `403` not allowed · `404` not found ·
`409` conflict (counter-proposal, expired hold, wrong state) · `500` unexpected (no internal details).

## More documentation

- ER diagram: [`database/diagrams/erd.md`](database/diagrams/erd.md)
- Data dictionary: [`docs/project/database_dictionary.md`](docs/project/database_dictionary.md)
- Design decisions and where we differ from the plan: [`docs/decisions/decisions.md`](docs/decisions/decisions.md)
- Viva notes (how to explain each mechanism): [`docs/project/viva_notes.md`](docs/project/viva_notes.md)

## Screenshots

| Counter-proposal | Donation timeline |
|---|---|
| ![Counter-proposal](docs/screenshots/counter-proposal.png) | ![Timeline](docs/screenshots/donation-timeline.png) |

## Deliberately excluded

These are conscious scope decisions, not forgotten features.

1. Meal sponsorship, monetary donations and payment processing.
2. Restaurant or food-delivery integrations (Zomato etc.) and external order tracking.
3. Medical supplies and other regulated or safety-sensitive goods.
4. Prepared or perishable food.
5. Real courier/logistics integrations. Pickup and delivery are recorded inside GiveGrid.
6. In-app chat and push/live notifications.
7. PostGIS distance and route optimisation. City and locality are enough for the MVP.
8. Rebuilding state at any past moment from the event log, and hash-chained events.
9. Advanced fraud detection or identity verification beyond admin review of NGOs.
10. Mobile apps, microservices, Kubernetes, GraphQL, NoSQL and AI/ML features.
11. Returns or disputes after pickup.
