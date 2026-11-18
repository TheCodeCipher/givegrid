# What the professor asked for, and where it is

I re-checked the professor's guide ("Your Project — Full Stack Development", 8 pages) and the
feedback on our proposal. **Concurrency is the main one, but not the only one.** Here's every
requirement, where it is, and what proves it.

## A. The hard rules from the guide (page 1)

> "It will handle at least five thousand rows of data without slowing down, refuse invalid requests
> even when they bypass your interface, and behave correctly when two people use it at the same
> instant. That last part is the whole point."

| # | Requirement | Where | Proof |
|---|---|---|---|
| 1 | Front end + back end + real database | `frontend/`, `backend/`, MySQL | it runs |
| 2 | **5,000+ rows without slowing down** | `scripts/seed.js` (10,272 rows), indexes in `schema.sql` | `tests/7-performance.test.js`: row count > 5000, replies < 300 ms, indexes used |
| 3 | **Refuse invalid requests even if they bypass the interface** | `backend/validate.js`, `auth.js`, ownership checks in routes/services, DB constraints | `tests/4-security.test.js` (Postman-style attacks), `tests/5-database.test.js` |
| 4 | **Correct when two people act at the same instant** | `backend/services/claims.js` (`FOR UPDATE` row locks) | `tests/6-concurrency.test.js` |
| 5 | At least one hard requirement (concurrency / multi-row transaction / append-only history) | **all three** | see table B |
| 6 | "Describe the exact test that would catch it if you got it wrong" | the 70 + 70 test | first test in `6-concurrency.test.js`; the break-it experiment |

## B. The three kinds of hard requirement (page 2)

| Kind | The danger | How we stop it | Test |
|---|---|---|---|
| **Concurrency**: two users, one limited thing, only one may win | Both NGOs read "100 left", both take 70 → 140 promised | Lock the donation row first (`SELECT ... FOR UPDATE`); the second claim waits, then sees 30 | "PROFESSOR'S TEST: two claims of 70..." |
| **Multi-row transaction**: several rows change together or not at all | Stock goes down but the claim row is never saved (crash halfway) | `withTransaction`: BEGIN … COMMIT, any error → ROLLBACK | "if a claim fails halfway, every change it made is undone" |
| **Append-only history**: the past is never overwritten | Someone edits history to hide a claim | MySQL privileges (app can only SELECT/INSERT) + triggers that refuse UPDATE/DELETE + UNIQUE(donation_id, seq) | the "APPEND-ONLY history" tests |

## C. Things the guide says are marked

| What the guide says | Where we do it |
|---|---|
| "Conditional rendering: loading, error and empty states. **Essential. This is marked**" | every list in the frontend uses `showLoading`, `showError`, `showTable(... emptyText)` (`frontend/js/common.js`) |
| "REST design: sensible URLs, correct HTTP methods and status codes. **This is marked**" | nouns in URLs (`/donations/:id/claims`), GET reads, POST creates, PATCH edits part; 200/201/400/401/403/404/409/500 (see `3-BACKEND.md` section 9) |
| "Auth: enough to protect every route" | every route except health, categories, register, login needs `authenticate` |
| "bcrypt: never store a plain password" | `authRoutes.js`; test "the password is stored as a bcrypt hash" |
| "Server validation: **Essential. Tested with Postman**" | `validate.js`; Postman folder 5 "Must be refused" |
| "SQL: SELECT, JOIN, GROUP BY, aggregates" | JOINs in every list; GROUP BY + SUM + HAVING in the invariant checks and the seed |
| "Schema design: normalisation, keys, relationships" | 7 tables, no repeated data, foreign keys (`2-DATABASE.md`) |
| "Constraints: UNIQUE, CHECK, NOT NULL, foreign keys. **You must be able to write them**" | `schema.sql`, each tested in `5-database.test.js` |
| "Transactions: BEGIN, COMMIT, ROLLBACK, and row locking" | `db.js` + `claims.js` |
| "Indexes: know when to add one and why" | `schema.sql` bottom; evidence in `2-DATABASE.md` section 6 |
| "Postman: we will use it on your submission" | `docs/GiveGrid.postman_collection.json` |
| "Git and GitHub: part of the assessment" | your repository history |
| ".env: keeping secrets out of the repository" | `.env` in `.gitignore`, `.env.example` committed |
| Optional bonus: "Jest or Vitest: automated tests, **4 bonus marks**" | 115 Jest + Supertest tests |
| "NoSQL databases: explicitly disallowed" | MySQL only |
| "Plain HTML, CSS and JavaScript are permitted instead of React... lose no marks" | our frontend |
| "AI assistants: permitted — but you must be able to explain every line you submit" | this whole `docs/` folder |

## D. The professor's feedback on our proposal, and what we did

| Feedback | What we did |
|---|---|
| The original test (70 then 60, one after the other) **didn't test concurrency**: it passes even if the code is broken | The test now fires **two 70-chair claims at the same instant** with `Promise.all` |
| Partial fulfilment needs a **policy** | Counter-proposal: reply 409 with `offer`, reserve nothing; accepting = a new claim that is checked again |
| Append-only was a **promise, not enforced** | Enforced in MySQL: privileges + triggers + UNIQUE(donation_id, seq) + a test that attacks it as the app account |
| Sponsored meals = too much scope | Excluded (README "Deliberately excluded") |
| Add a "Deliberately Excluded" section | In the README |
| Suggested upgrades: hold-then-confirm with expiry, ranked matching, split donations | All three built (48-hour holds, ranked matching, split donations) |
| Suggested upgrade: rebuild past state from history | Not built; listed as excluded (stretch goal) |
