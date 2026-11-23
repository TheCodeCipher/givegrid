# GiveGrid
GiveGrid is a web app connecting donors with verified NGOs to match usable physical goods with actual resource needs. 
It lets donors list items and NGOs post specific requests. The platform discovers matches and manages the complete donation workflow - from claiming to handover - ensuring useful resources reach the organisations that need them. 

**Connecting available resources with verified community needs.**
Full Stack Development course project · Tarun Das and Arkodyuti Bhattacharyya

Donors (people, offices, hotels, event organisers) list usable goods they no longer need.
NGOs post what they need. An admin verifies each NGO. Verified NGOs see ranked matches and
claim exactly the quantity they can use. One donation can be split between several NGOs.

## The hard requirements

> **If two NGOs claim the same donation at the same moment, a naive version would let both
> succeed and promise more items than the donor has.**

| Kind | In GiveGrid | Proof |
|---|---|---|
| 1. Concurrency | 100 chairs, two claims of 70 at the same instant: exactly one wins, 30 remain | `tests/6-concurrency.test.js` |
| 2. Multi-row transaction | A claim changes 4 rows (donation stock, need, claim, history) together or not at all | `tests/5-database.test.js` (rollback test) |
| 3. Append-only history | `donation_events` cannot be updated, deleted or wiped, enforced by MySQL itself | `tests/5-database.test.js` |

**Partial claims (counter-proposal).** If an NGO asks for more than is available, the server replies
`409` with `offer: <what is available>`. Nothing is reserved. To accept, the NGO claims the offered amount,
and the server checks the stock again.

**48-hour holds.** A claim is held for 48 hours. If the NGO does not confirm a pickup plan in time,
a timer releases the items, exactly once.

## Stack 

HTML · CSS · JavaScript (no framework) · Node.js · Express 4 · MySQL 8 (`mysql2`) · bcrypt · JWT ·
Jest + Supertest · Postman · Git. MongoDB is not used, because the course guide says
*"NoSQL databases: explicitly disallowed"*.

## Run it

Needs Node.js 18+ and MySQL 8 **or** MariaDB 10.5+. Tested with MySQL 8 and MariaDB 10.11.

```text
1. npm install
2. copy .env.example to .env and fill in your MySQL root password and two new passwords
3. npm run setup     creates the two databases, all tables, and the limited app account
4. npm run seed      loads demo accounts and 10,272 rows
5. npm start         open http://localhost:3000
6. npm test          runs all 120 tests (uses the separate givegrid_test database)
```

Demo logins (password `password123`): `donor@givegrid.local`, `ngo@givegrid.local`,
`admin@givegrid.local`. An unverified NGO: `ngo10@givegrid.local`.

> **The demo accounts and data only exist after `npm run seed` (step 4).** Without it the site
> runs but is empty, and the demo logins fail with "Wrong email or password".
> `npm run seed` **empties the `givegrid` database first**, then loads the demo data, so run it
> again whenever you want a fresh demo. It never touches `givegrid_test` (the tests' database).
> On a deployed copy, run it once with `.env` pointing at the cloud database.

## Folder map

```text
backend/        the server (Express + MySQL)       -> docs/3-BACKEND.md
  routes/         one file per URL group
  services/       claims (the hard part), history, matching
database/       schema.sql: every table and rule   -> docs/2-DATABASE.md
scripts/        setup.js (build database), seed.js (demo data)
frontend/       plain HTML/CSS/JS pages             -> docs/5-FRONTEND.md
tests/          7 kinds of tests, 120 tests         -> docs/4-TESTS.md
docs/           technical documentation and the Postman collection
```

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/health`, `/api/health/db` | anyone | is the server / database up? |
| GET | `/api/categories` | anyone | categories for dropdowns |
| POST | `/api/auth/register`, `/api/auth/login` | anyone | get a login token |
| GET | `/api/auth/me` | logged in | who am I |
| POST, GET | `/api/ngos`, `/api/ngos/me` | NGO | create / read my NGO profile |
| GET, PATCH | `/api/admin/ngos`, `/api/admin/ngos/:id/verification` | admin | list / verify NGOs |
| POST | `/api/donations` | donor | list a donation |
| GET | `/api/donations` (`?mine=true`), `/api/donations/:id` | logged in | list / one |
| PATCH | `/api/donations/:id` | owner | edit title and description |
| POST | `/api/donations/:id/close` | owner | stop new claims |
| GET | `/api/donations/:id/events` | logged in | history |
| GET | `/api/donations/:id/matching-needs` | logged in | needs ranked for this donation |
| **POST** | **`/api/donations/:id/claims`** | **NGO** | **claim (also how you accept an offer)** |
| POST, GET | `/api/needs` (`?mine=true`), `/api/needs/:id` | NGO / logged in | post / needs board / one |
| GET | `/api/needs/:id/matches` | logged in | donations ranked for this need |
| GET | `/api/claims` | logged in | claims I am part of |
| POST | `/api/claims/:id/confirm`, `cancel`, `deliver`, `receipt` | NGO | move a claim forward |
| POST | `/api/claims/:id/pickup` | donor | record the handover |

Status codes: `200` OK · `201` created · `400` bad input · `401` not logged in · `403` not allowed ·
`404` not found · `409` conflict (counter-proposal, wrong status, expired hold) · `500` server error
(never shows SQL or a stack trace). Postman collection: `docs/GiveGrid.postman_collection.json`.

## Results

- **120 tests pass** (unit, smoke, functional, security, database, concurrency, performance). Coverage 93% of lines.
- Removing `FOR UPDATE` from the claim makes **5 of the 9 concurrency tests fail**, so the tests really detect the race.
- With the locks, the concurrency tests passed **10 runs out of 10**.
- **10,272 rows** seeded. Every measured request replied in a few milliseconds. Indexes checked with `EXPLAIN`.

## Deliberately excluded

Left out on purpose to keep the scope focused (agreed after the feedback on our proposal):

1. Meal sponsorship, money donations, payments.
2. Restaurant or food-delivery integrations (e.g. Zomato).
3. Medical supplies and other regulated goods.
4. Cooked or perishable food.
5. Courier or logistics integrations (pickup and delivery are recorded inside GiveGrid).
6. Chat and live notifications (Socket.io).
7. Map distance (PostGIS). City and area are enough.
8. Rebuilding past state from history at any moment; hash-chained history.
9. Fraud detection or ID checks beyond the admin verifying NGOs.
10. Returns or disputes after pickup.
11. Mobile apps, microservices, GraphQL, NoSQL, AI/ML.
