# Backend

Everything in `backend/`. Express 4 + MySQL (`mysql2`).

```text
backend/
├── server.js        starts listening + the expiry timer
├── app.js           builds Express: middleware, routes, errors
├── config.js        reads .env
├── db.js            MySQL pool + withTransaction
├── auth.js          JWT, authenticate, authorise
├── errors.js        HttpError, asyncHandler
├── security.js      security headers, login limiter
├── validate.js      input checks
├── rules.js         decideClaim, STEPS
├── routes/          one file per URL group
└── services/
    ├── claims.js    claims, locking, expiry (the hard requirement)
    ├── events.js    writes history
    └── matching.js  ranking queries
```

---

## 1. The journey of one request

Example: an NGO clicks "Claim" → `POST /api/donations/7/claims` with body `{ "need_id": 3, "quantity": 70 }`.

```text
Browser (matches.js)  fetch('/api/donations/7/claims', { method: 'POST', headers: {Authorization: 'Bearer eyJ...'}, body })
   │
   ▼
server.js            the server is listening on port 3000
   │
app.js               express.json()        → body text becomes req.body = { need_id: 3, quantity: 70 }
   │                 express.static        → not a file in frontend/, so it moves on
   │                 app.use('/api/donations', donationRoutes)   → matches the start of the URL
   ▼
donationRoutes.js    router.use(authenticate)   → checks the token, sets req.user = { id: 12, role: 'NGO' }
   │                 router.post('/:id/claims', authorise('NGO'), handler)
   │                 authorise('NGO')            → role is NGO, so next()
   │                 handler:  validate.id('7')  → 7
   │                           validate.id(3)    → 3
   │                           validate.quantity(70) → 70
   │                           claims.createClaim(req.user, 7, 3, 70)
   ▼
services/claims.js   BEGIN → lock donation 7 → lock need 3 → check rules → decide → write 4 rows → COMMIT
   │
   ▼
handler              res.status(201).location('/api/claims/55').json(claim)
   │
Browser              res.ok is true → shows "Reserved 70..."
```
If anything throws on the way (bad token, bad quantity, not enough stock), the error jumps straight to
the **error handler** at the bottom of `app.js`, which sends `{ "error": "..." }` with the right status.

**Layers:** route (HTTP: read the request, validate, reply) → service (business logic + SQL) →
MySQL. Simple routes (e.g. "get one need") run their SQL directly in the route file; the risky logic
(claims, history, matching) lives in `services/` so it can be read and tested on its own. This follows
the layered route → controller → service → model structure, with the controller kept inside the route
file because each handler is only a few lines.

## 2. `app.js` and `server.js`: why two files

- `app.js` **builds** the app and exports it. It never calls `listen`.
- `server.js` **starts** it: `app.listen(PORT)` + the expiry timer.
- Why: tests import `app.js` and Supertest runs it on a temporary port for each request. If `app.js`
  called `listen`, every test file would try to grab port 3000 and the tests would clash and not exit.

**Middleware order in `app.js` (order matters: first match wins):**
0. `trust proxy` (only when `TRUST_PROXY=true`, i.e. on Railway): `req.ip` = the visitor's real IP, not the proxy's.
1. `app.disable('x-powered-by')` and `securityHeaders`: safety headers on every reply (`security.js`).
2. `express.json({ limit: '10kb' })`: reads JSON bodies into `req.body`. Broken JSON → 400; a body over 10 kB → 413.
3. `express.static('frontend')`: if the URL is a file in `frontend/` (e.g. `/donor.html`), send it.
   Same server for pages and API = same origin, so the browser needs **no CORS** setup.
4. `/api/health`, `/api/health/db`, `/api/categories`: three small public routes.
5. The six routers.
6. `app.use('/api', ...)`: nothing matched → 404 `{ error: 'Route not found' }`.
7. The error handler `(err, req, res, next)`: Express knows it's an error handler because it has **4 arguments**.

**The error handler decides:**
- `HttpError` (thrown on purpose) → its own status + message (+ extras like `offer`).
- `err.type === 'entity.parse.failed'` (bad JSON) → 400.
- `err.type === 'entity.too.large'` (body over 10 kB) → 413.
- anything else (a real bug) → log it with `console.error`, reply **500 "Something went wrong on the server"**.
  Never the SQL or stack trace: those would tell an attacker about our database.

**`server.js` expiry timer:** `setInterval(runExpiry, 60 * 1000)` runs `claims.expireOldHolds()`
every minute. It's wrapped in try/catch so one failure (e.g. database briefly down) doesn't crash the server.

## 3. `config.js`, `db.js`, `errors.js`

**config.js:** `require('dotenv').config(...)` copies `.env` into `process.env`. It checks the important
variables exist and throws a clear message if not. `isTest` is true when Jest runs (Jest sets
`NODE_ENV=test`), and then `db.js` connects to `givegrid_test`.

**db.js:**
- `mysql.createPool({...})`: keeps up to 10 connections open and lends one per query. Logs in as
  **givegrid_app** (the limited account), never root.
- `pool.query(sql, values)` returns `[rows, fields]`. We write `const [rows] = await pool.query(...)`
  to take just the rows (array destructuring).
- For INSERT/UPDATE, the first item is a result: `result.insertId` (new id) and `result.affectedRows`
  (how many rows changed; 0 = nothing matched).
- **`withTransaction(work)`**: the multi-row transaction. Line by line:
  ```js
  const conn = await pool.getConnection();   // borrow ONE connection (a transaction lives on one connection)
  await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');   // see 2-DATABASE.md §7
  await conn.beginTransaction();             // BEGIN
  const result = await work(conn);           // run the caller's queries ON THIS conn
  await conn.commit();                       // COMMIT: all saved together, locks released
  // on any error:  await conn.rollback();   // ROLLBACK: all undone together, locks released
  // finally:       conn.release();          // give the connection back to the pool
  ```

**errors.js:**
- `class HttpError extends Error`: an error that carries a `status` (and optional `extra` fields).
- `asyncHandler(fn)`: **handles async errors in Express 4**. If an `async` route throws, Express 4 doesn't notice;
  the request hangs forever. `asyncHandler` adds `.catch(next)`, so the error reaches the error handler.
  Every async route is wrapped in it.

## 4. Login: bcrypt, JWT, authenticate, authorise (`auth.js`, `routes/authRoutes.js`)

**Register** (`POST /api/auth/register`):
1. Validate name, email, password (8 to 72 characters; bcrypt ignores bytes after 72), role (only DONOR or NGO; nobody can self-register as ADMIN).
2. `bcrypt.hash(password, 10)`: a **one-way** hash with a random **salt**. 10 is the cost factor (2^10
   rounds, slow on purpose so guessing millions of passwords is too slow). Same password → different
   hash each time because of the salt.
3. INSERT. If MySQL says `ER_DUP_ENTRY` (UNIQUE email), reply **409**.
4. Reply 201 with a token and the user (never the hash).

**Login** (`POST /api/auth/login`):
1. Login limiter (`security.js`): after 5 wrong passwords for the same email from the same IP, reply
   **429** for 15 minutes. A correct login resets the count.
2. Find the user by email; `bcrypt.compare(typed, storedHash)` re-hashes with the stored salt and compares.
3. Wrong email **or** wrong password → the **same** 401 message, so an attacker can't learn which emails
   have accounts (*user enumeration*).

**JWT** (`makeToken`): `jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '1d' })`.
- A JWT is three parts `header.payload.signature`, each base64url text.
- The payload is **readable by anyone** (it's signed, not encrypted), so we put only `id` and `role`
  in it, never a password.
- The signature is an HMAC (HS256) of header+payload with our secret. Change one letter of the payload
  (e.g. role DONOR → ADMIN) and the signature no longer matches, so `jwt.verify` throws.
- `iat` (issued at) and `exp` (expires) are added automatically.

**`authenticate`** (middleware): reads `Authorization: Bearer <token>`. Missing → 401. `jwt.verify`
fails (forged, expired) → 401. Valid → `req.user = { id, role }`, then `next()`.

**`authorise('NGO')`** (middleware factory: a function that returns a middleware): if `req.user.role`
isn't in the allowed list → 403.

**401 vs 403:** 401 = *we don't know who you are* (log in). 403 = *we know who you are, you're not allowed*.

**Ownership is checked separately**, in the route/service, by comparing ids: e.g. "is `need.ngo_id`'s
owner the same as `req.user.id`?" A role check alone isn't enough: any NGO has role NGO.

**Where the token lives in the browser:** `localStorage`. Simple, but readable by JavaScript on our page,
which is why we escape all text (`esc()`, see `5-FRONTEND.md`) to prevent XSS. An HttpOnly cookie is
the safer alternative (JS can't read it); we chose localStorage for simplicity.

## 5. The claim: `createClaim` in `services/claims.js`

This is the hard requirement.

**The race without locks:**
```text
time   NGO A (wants 70)                      NGO B (wants 70)
 1     reads available = 100
 2                                           reads available = 100
 3     70 <= 100 → writes available = 30
 4                                           70 <= 100 → writes available = 30
result: two claims of 70 = 140 promised from 100.
```

**With the lock:**
```text
time   NGO A                                  NGO B
 1     BEGIN; SELECT donation FOR UPDATE  ✔ (gets the lock)
 2                                           BEGIN; SELECT donation FOR UPDATE … WAITS
 3     reads 100, reserves 70, COMMIT (lock released)
 4                                           … gets the lock, reads available = 30
 5                                           70 > 30 → 409 counter-proposal: offer 30
```

**The five steps, with the code:**

| Step | Code | Why |
|---|---|---|
| 1. Lock the donation | `SELECT * FROM donations WHERE id = ? FOR UPDATE` | competing claims queue here |
| 2. Lock the need | `SELECT * FROM needs WHERE id = ? FOR UPDATE` | we'll lower `remaining_quantity` too |
| 3. Check rules | NGO owns the need (403), NGO VERIFIED (403), both OPEN (409), same category+unit (400) | server checks everything, using the locked rows |
| 4. Decide | `rules.decideClaim(quantity, donation.available_quantity, need.remaining_quantity)` | uses the **fresh, locked** numbers, never numbers from the browser |
| 5. Write | UPDATE donations (−qty), UPDATE needs (−qty), INSERT allocations (HELD, `DATE_ADD(NOW(), INTERVAL 48 HOUR)`), `events.addEvent(CLAIM_HELD)` | all inside one transaction: 4 rows, all or nothing |

**`decideClaim` (`rules.js`):** `most = Math.min(available, stillNeeded)`.
- `most === 0` → NOTHING → 409 "Nothing can be reserved".
- `requested > most` → COUNTER → 409 with `{ offer: most, available, stillNeeded }`.
- otherwise → RESERVE.

**Why the counter-proposal reserves nothing:** it's a `throw` before any UPDATE/INSERT, and the throw
makes `withTransaction` ROLLBACK. If offers held stock, an NGO that never answers would block it.

**Accepting an offer** is just another `POST /api/donations/:id/claims` with `quantity = offer`.
There's no "accept" endpoint, because the offer isn't stored anywhere. The new request locks and checks
again, so if another NGO took the stock in between, the late one gets 409 (tested: "an old offer is
checked again" and "two NGOs accept the same counter-offer at once").

**Why the deadline uses `NOW()` in SQL:** one clock (the database's) for everyone. The browser's
clock or two servers' clocks could disagree.

## 6. The rest of a claim's life: `changeClaim` and `STEPS`

`STEPS` in `rules.js` describes every move as data:

| step | who | allowed from | to | history | gives back? | deadline checked? |
|---|---|---|---|---|---|---|
| confirm | NGO | HELD | CONFIRMED | HOLD_CONFIRMED | | yes |
| cancel | NGO | HELD, CONFIRMED | CANCELLED | CLAIM_CANCELLED | **yes** | |
| pickup | DONOR | CONFIRMED | PICKED_UP | PICKED_UP | | |
| deliver | NGO | PICKED_UP | DELIVERED | DELIVERED | | |
| receipt | NGO | DELIVERED | RECEIVED | RECEIPT_CONFIRMED | | |

`changeClaim(user, claimId, stepName)` does the same for all five:
1. `lockClaim`: read which donation/need the claim belongs to (plain read: those ids never change),
   then lock **donation → need → claim** (the agreed order) and read the claim's status **now**,
   plus `is_expired` (MySQL computes `expires_at <= NOW()` → 1 or 0).
2. Who check: NGO steps → the NGO that owns the need; pickup → the donor. Else 403.
3. Status check: `step.from.includes(claim.status)`, else **409** "Cannot pickup a claim that is HELD".
4. Deadline check for confirm: if `is_expired` → 409 (even if the timer hasn't run yet).
5. If `givesBack`: add the quantity back to the donation and the need (`giveBack`).
6. UPDATE the status, add the history row, COMMIT.

**Cancel vs pickup at the same instant:** both lock the same rows, so one goes first. If pickup goes
first, the claim becomes PICKED_UP; cancel then sees PICKED_UP, which isn't in `['HELD','CONFIRMED']`,
so 409. Stock is never given back after pickup. Tested in `6-concurrency.test.js`.

**Why the donor records pickup:** the donor is the person who can say the goods left their hands.

## 7. Expiry: released at most once

- `expireOldHolds()` (called every minute by `server.js`):
  1. **Without locking**, find candidates: `SELECT id FROM allocations WHERE status = 'HELD' AND expires_at <= NOW()`.
  2. For each id, `expireOne(id)` in its **own** transaction.
- `expireOne(id)`: `lockClaim`, then **check again**: `status === 'HELD'` and `is_expired`. If not
  (someone confirmed or cancelled it a moment ago, or another run already expired it) → do nothing.
  Otherwise give back, set EXPIRED, add HOLD_EXPIRED with `actor_id = NULL` (the system did it).
- **Why "at most once":** the second run waits for the lock, then sees EXPIRED and stops. Tested by
  running five expiry runs at the same time: total expired = 1, stock = 100 (not 170).
- **Expiry vs a new claim at the same instant:** both need the donation lock. Expiry first → 70 come
  back, the new claim takes them. Claim first → it sees only 30 and gets an offer of 30; then expiry
  gives 70 back. Either order is correct.

## 8. History: `services/events.js`

```js
SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM donation_events WHERE donation_id = ?
INSERT INTO donation_events (donation_id, seq, action, quantity, actor_id, allocation_id) VALUES (...)
```
- Called **inside** the same transaction as the change it describes, using the same `conn`.
  If the change rolls back, so does its history line. They can never disagree.
- The caller already holds the donation's lock, so only one transaction at a time computes `nextSeq`
  for that donation. `UNIQUE (donation_id, seq)` catches it if that ever went wrong.
- `COALESCE(x, 0)` = "x, or 0 if x is NULL" (no events yet → MAX is NULL → next is 1).

## 9. Every route

`auth` = needs a valid token. Middleware runs left to right.

### `routes/authRoutes.js` → `/api/auth`
| Method + path | Middleware | Does | Replies |
|---|---|---|---|
| POST `/register` | – | validate, bcrypt.hash, INSERT user | 201 `{token, user}` · 400 · 409 duplicate email |
| POST `/login` | – | login limiter check, SELECT by email, bcrypt.compare | 200 `{token, user}` · 400 · 401 · 429 after 5 wrong passwords |
| GET `/me` | authenticate | SELECT id, name, email, role | 200 · 401 |

### `routes/ngoRoutes.js` → `/api/ngos` (whole file: authenticate, authorise('NGO'))
| POST `/` | INSERT ngo (status defaults to PENDING; any `status` in the body is ignored) | 201 · 400 · 409 already has one |
|---|---|---|
| GET `/me` | SELECT my NGO | 200 · 404 not registered yet |

### `routes/adminRoutes.js` → `/api/admin` (whole file: authenticate, authorise('ADMIN'))
| GET `/ngos?status=` | list NGOs with owner email, optional filter (`? IS NULL OR status = ?`) | 200 · 400 bad status |
|---|---|---|
| PATCH `/ngos/:id/verification` | UPDATE status to VERIFIED/REJECTED (`affectedRows 0` → 404) | 200 · 400 · 404 |

### `routes/donationRoutes.js` → `/api/donations` (whole file: authenticate)
| Method + path | Extra middleware | Does | Replies |
|---|---|---|---|
| POST `/` | authorise('DONOR') | transaction: INSERT donation (available = total) + DONATION_POSTED | 201 + Location · 400 (also bad category via FK error) |
| GET `/` | – | open donations, or `?mine=true` = all mine; `limit` ≤ 100, `offset` | 200 · 400 |
| GET `/:id` | – | one donation + category + donor name | 200 · 400 · 404 |
| PATCH `/:id` | authorise('DONOR') | owner only: title, description | 200 · 403 · 404 |
| POST `/:id/close` | authorise('DONOR') | transaction: lock, owner check, CLOSED + DONATION_CLOSED | 200 · 403 · 404 · 409 already closed |
| GET `/:id/events` | – | history ordered by seq, LEFT JOIN users for names | 200 · 404 |
| GET `/:id/matching-needs` | – | `matching.needsForDonation` | 200 · 404 |
| **POST `/:id/claims`** | authorise('NGO') | `claims.createClaim` | **201** reserved · **409 + offer** · 400 · 403 · 404 |

### `routes/needRoutes.js` → `/api/needs` (whole file: authenticate)
| POST `/` | authorise('NGO') | must have a VERIFIED NGO; INSERT (remaining = required) | 201 + Location · 400 · 403 |
|---|---|---|---|
| GET `/` | – | needs board: OPEN, still needed, HIGH first (`ORDER BY FIELD(urgency,'HIGH','MEDIUM','LOW')`), max 50; or `?mine=true` | 200 |
| GET `/:id` | – | one need | 200 · 404 |
| GET `/:id/matches` | – | `matching.donationsForNeed` | 200 · 404 |

### `routes/claimRoutes.js` → `/api/claims` (whole file: authenticate)
| GET `/` | – | `claims.listClaims`: NGO sees its claims, donor sees claims on its donations, admin all | 200 |
|---|---|---|---|
| POST `/:id/confirm` | authorise('NGO') | `changeClaim(..., 'confirm')` | 200 · 403 · 404 · 409 |
| POST `/:id/cancel` | authorise('NGO') | `changeClaim(..., 'cancel')` | 200 · 403 · 404 · 409 |
| POST `/:id/pickup` | authorise('DONOR') | `changeClaim(..., 'pickup')` | 200 · 403 · 404 · 409 |
| POST `/:id/deliver` | authorise('NGO') | `changeClaim(..., 'deliver')` | 200 · 403 · 404 · 409 |
| POST `/:id/receipt` | authorise('NGO') | `changeClaim(..., 'receipt')` | 200 · 403 · 404 · 409 |

`stepHandler(stepName)` builds the handler for each of the five, so they're identical apart from the name.

### REST design choices
- **Nouns in URLs, verbs in HTTP methods:** `/donations/7/claims` (a claim belongs to a donation).
- **GET** never changes anything. **POST** creates. **PATCH** changes *part* of a row (we edit only
  title/description, or only status). PUT would mean "replace the whole row", which we never do.
- State changes like `/claims/5/confirm` are POST because they're actions with side effects (history
  rows, stock changes), and repeating them is not harmless (POST is not idempotent).
- **201 + Location header** when something is created: the header says where it now lives.
- **409 Conflict** = the request is valid but clashes with the current state (not enough stock, wrong
  status, hold expired). It's an expected answer, not a crash.
- **No DELETE routes:** nothing in GiveGrid is ever deleted (history must stay answerable); closing and
  cancelling are status changes instead. The app's database account doesn't even have DELETE permission.

## 10. Matching (`services/matching.js`)

`donationsForNeed(needId)`: JOIN needs to donations **on the same category and unit** (category fit),
keep OPEN donations with stock, score:
```sql
(CASE WHEN d.available_quantity >= n.remaining_quantity THEN 30 ELSE 0 END)          -- quantity fit
+ (CASE WHEN d.city = n.city AND d.locality = n.locality THEN 20                       -- same area
        WHEN d.city = n.city THEN 10 ELSE 0 END)                                        -- same city
ORDER BY score DESC, d.available_quantity DESC, d.id LIMIT 50
```
`needsForDonation(donationId)`: the same, plus urgency `HIGH +30, MEDIUM +15, LOW 0`, only VERIFIED NGOs.

- Ties broken by quantity then id, so the order is always the same (deterministic).
- MySQL compares text case-insensitively by default, so "delhi" matches "Delhi".
- `NULL = NULL` is not true in SQL, so two donations with no locality only get the city points.

## 11. Validation (`validate.js`) and security, in one list

| Threat | Defence | Where |
|---|---|---|
| Bad input sent directly (Postman, curl) | every field checked: type, whole number, range, length, allowed values | `validate.js`, start of each route |
| `"10"` instead of `10` | `Number.isInteger` is false for text → 400 | `validate.quantity` |
| **SQL injection** | every value goes through `?` placeholders; mysql2 escapes it, so it's data, never SQL | every query |
| **Mass assignment** (sending `status: VERIFIED`) | we pick fields one by one, never `INSERT ... req.body` | every POST/PATCH |
| Self-made admin | register only allows DONOR/NGO | authRoutes |
| Forged/expired token | `jwt.verify` checks signature and `exp` | auth.js |
| Someone else's data | ownership checks comparing ids (403) | services/claims.js, donationRoutes |
| Leaking password hashes | user queries name their columns; login removes the hash before replying | authRoutes |
| Leaking internals | 500 replies are a fixed message | app.js error handler |
| User enumeration | same login error for both cases | authRoutes |
| Secrets in Git | `.env` in `.gitignore`; `.env.example` has placeholders | root |
| Stolen DB password | least privilege: app account can't delete or rewrite history | scripts/setup.js |
| XSS (script in a title) | the frontend escapes all text with `esc()` | frontend/js/common.js |
| CORS | not needed: frontend and API on the same origin | app.js |
| Clickjacking, scripts from other sites, file-type guessing | security headers (X-Frame-Options, CSP, nosniff), `X-Powered-By` hidden | `backend/security.js`, app.js |
| Password guessing (brute force) | 5 wrong passwords for one email from one IP → 429 for 15 minutes | `security.js`, authRoutes |
| Huge request bodies | `express.json({ limit: '10kb' })` → 413 | app.js |

The headers and the login limiter are written by hand (about 30 lines in `security.js`) instead of
using the `helmet` and `express-rate-limit` packages, which keeps the dependency list short and the
behaviour visible in our own code.
