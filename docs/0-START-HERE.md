# Start here

This folder teaches you GiveGrid well enough to defend every part of it. Read in this order.
Don't read everything: each step says what it's for and when it's done.

## The one-sentence version (memorise this first)

> GiveGrid lets donors give goods to verified NGOs. Its hard part is that **two NGOs claiming
> the same donation at the same instant can never get more than exists**. We solve it with a
> **transaction** that **locks the donation row** (`SELECT ... FOR UPDATE`) before reading the stock,
> and we keep an **append-only history** that MySQL itself refuses to change.

---

## Your 3-day plan

Each step has a **done when**. When it's true, move on, even if you feel there's more to know.
There always is. The viva questions are in `7-VIVA-QUESTIONS.md`; that's the finish line.

### Day 1 — run it, then learn the hard part (about 4 hours)

| # | Do this | Done when |
|---|---|---|
| 1 | Open the project in WebStorm. In the terminal: `npm install` | no red errors |
| 2 | Copy `.env.example` to `.env`, fill in passwords. Run `npm run setup`, then `npm run seed` | you see the table of row counts |
| 3 | `npm start`, open http://localhost:3000. Log in as ngo@givegrid.local, post a need, claim more than exists, see the counter-offer, accept it | you've seen the yellow "Only X can be reserved" box |
| 4 | `npm test` | it says 115 passed |
| 5 | Read `2-DATABASE.md` sections 1–3 (tables, quantities, claim statuses) | you can draw the 7 tables and their arrows on paper |
| 6 | Read `3-BACKEND.md` section 5 (the claim) with `backend/services/claims.js` open next to it | you can explain the 5 steps of `createClaim` without looking |
| 7 | Do the **break-it experiment** (below) | you've seen tests fail without the lock |

**The break-it experiment** (the most convincing thing you can show an examiner):
1. In `backend/services/claims.js`, in `createClaim`, delete ` FOR UPDATE` from the two lock queries.
2. Run `npx jest --runInBand tests/6-concurrency.test.js`. About 5 tests fail: over-allocation happens.
3. Put `FOR UPDATE` back. Run again. All pass.

### Day 2 — the rest of the backend and the tests (about 4 hours)

| # | Do this | Done when |
|---|---|---|
| 1 | `3-BACKEND.md` sections 1–4 (request journey, middleware, auth, errors) | you can trace a request from browser to MySQL and back |
| 2 | `3-BACKEND.md` sections 6–8 (claim life, expiry, history) | you can explain "released at most once" |
| 3 | `2-DATABASE.md` sections 4–6 (constraints, append-only, indexes) | you can name the 3 layers that protect history |
| 4 | `4-TESTS.md` | you can name the 7 kinds of test and what each checks, in one line each |
| 5 | Open Postman, import `docs/GiveGrid.postman_collection.json`, run folder 3 (NGO) | you've seen the 409 counter-proposal in Postman |

### Day 3 (or the morning of the viva) — rehearse (about 2 hours)

| # | Do this | Done when |
|---|---|---|
| 1 | Cover the answers in `7-VIVA-QUESTIONS.md` and answer out loud | you get the starred (★) questions right |
| 2 | Skim `5-FRONTEND.md` and `6-JS-YOU-NEED.md` | you know what `fetch`, `async/await` and `esc()` do |
| 3 | Do the demo once, start to finish (section "Demo" in `7-VIVA-QUESTIONS.md`) | under 6 minutes, nothing failed |

---

## Which files matter how much

You don't need to know every file equally. Three tiers:

**Tier 1: know these line by line** (this is where marks are)

| File | One line |
|---|---|
| `backend/services/claims.js` | the claim transaction, locking, counter-proposal, cancel, expiry |
| `backend/db.js` | the connection pool and `withTransaction` (BEGIN / COMMIT / ROLLBACK) |
| `backend/rules.js` | the decisions: `decideClaim` and the `STEPS` table |
| `database/schema.sql` | every table, constraint, trigger, index |
| `tests/6-concurrency.test.js` | the race tests, including the professor's 70 + 70 test |

**Tier 2: know what each part does and why**

| File | One line |
|---|---|
| `backend/app.js` | builds Express: middleware order, routes, 404, error handler |
| `backend/auth.js` | JWT tokens, `authenticate` (401), `authorise` (403) |
| `backend/services/events.js` | writes one history row, with the next number |
| `backend/services/matching.js` | the two ranking SQL queries |
| `backend/routes/*.js` | each URL: check input, call the database, reply |
| `backend/validate.js` | input checks that throw 400 |
| `scripts/setup.js` | creates databases, the limited account and its permissions |
| `tests/5-database.test.js` | constraints, append-only, rollback |
| `tests/4-security.test.js` | 401 / 403 / 400 / SQL injection |

**Tier 3: know they exist**

| File | One line |
|---|---|
| `backend/server.js` | starts the server and the once-a-minute expiry timer |
| `backend/config.js` | reads `.env` |
| `backend/errors.js` | `HttpError` and `asyncHandler` |
| `scripts/seed.js` | fills 10,000+ rows of demo data |
| `frontend/*` | the pages (see `5-FRONTEND.md`) |
| `tests/1,2,3,7` and `helpers.js` | unit, smoke, functional, performance tests |

---

## Running in WebStorm

- Open `package.json`: each script has a green ▶ next to it. Click it to run `setup`, `seed`, `start` or `test`.
- Or use the built-in terminal (Alt+F12).
- To run one test file: open it and click the ▶ next to `test(...)` or `describe(...)`.
- If `npm run setup` fails with "Access denied for user 'root'", your `DB_ADMIN_PASSWORD` in `.env` is wrong.

## If MySQL is not installed

All 115 tests were run and passed on **both MySQL 8.0 and MariaDB 10.11**. On EndeavourOS/Arch the
quickest is MariaDB: `sudo pacman -S mariadb`, then
`sudo mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql`,
`sudo systemctl start mariadb`, and set a root password:
`sudo mariadb -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'yourpassword';"`
Put that password in `.env` as `DB_ADMIN_PASSWORD`. XAMPP on Windows also ships MariaDB.
