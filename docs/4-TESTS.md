# Tests

**Run all:** `npm test` (= `jest --runInBand`). **One file:** `npx jest --runInBand tests/6-concurrency.test.js`.
**One test by name:** `npx jest --runInBand -t "PROFESSOR"`. **Coverage:** `npm run test:coverage`.

`--runInBand` = run test files **one after another**, not at the same time. All files share one
test database and wipe it before each test; running them in parallel would let them wipe each other.

## 1. Kinds of test

Following the testing pyramid: many fast **unit** tests at the bottom, fewer **integration** tests in
the middle, few **end-to-end** tests on top.

| File | Kind | Checks, in one line | Count |
|---|---|---|---|
| `1-unit.test.js` | **Unit** | one small function alone, no server, no database (`rules.js`, `validate.js`) | 27 |
| `2-smoke.test.js` | **Smoke** | is it alive at all? server answers, database connected, website served | 5 |
| `3-functional.test.js` | **Functional / integration** | each feature works as a user expects, through the real API to the real database | 25 |
| `4-security.test.js` | **Security** | attacks are refused: no login, fake token, wrong role, someone else's data, bad input, SQL injection, password guessing, oversized bodies; security headers present | 29 |
| `5-database.test.js` | **Database / integrity** | MySQL itself refuses bad data, refuses to change history, undoes half-finished work | 17 |
| `6-concurrency.test.js` | **Concurrency (race)** | the hard requirement: many requests at the same instant still give correct results | 9 |
| `7-performance.test.js` | **Performance** | with 10,000+ rows, requests stay fast and use our indexes | 8 |

Other kinds of testing and how they apply here:
- **Regression testing** = re-running all the old tests after every change, to catch something that
  used to work and broke. That's what `npm test` is: run it before every commit.
- **End-to-end (E2E)** = an automated browser clicks through the real website. The whole flow
  (donor → NGO → admin) was run once with a scripted browser with no JavaScript errors, and is
  repeated by hand with the checklist in section 5. It is not part of the Jest suite.
- **UAT (user acceptance testing)** = a real user checks it does what they need: the manual checklist in section 5.
- **Integration** is the same as our functional tests: they test the pieces *together* (route + service + MySQL).

## 2. How a test is structured

```js
test('a claim reserves immediately', async () => {
  // ARRANGE: set up what the test needs
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const ngo = await h.makeNgoWithNeed(50);

  // ACT: do the one thing being tested
  const res = await h.claim(ngo, donation.id, 40);

  // ASSERT: check the reply AND the database
  expect(res.status).toBe(201);
  expect((await h.row('donations', donation.id)).available_quantity).toBe(60);
});
```

Each test follows Arrange–Act–Assert and checks both the HTTP reply (via Supertest, which sends real
requests to `app.js` without starting a server) and what was actually saved in MySQL.

## 3. The helpers (`tests/helpers.js`)

| Helper | Does |
|---|---|
| `resetDb()` | empties all tables except categories (as root, using TRUNCATE) |
| `makeUser(role)` | inserts a user and returns `{ id, token }` |
| `makeNgoWithNeed(qty, status)` | NGO account + NGO (VERIFIED unless told) + a need for `qty` chairs |
| `makeDonation(donor, qty)` | creates a donation **through the API** |
| `claim(ngo, donationId, qty)` | the NGO claims |
| `post/get/patch(url, user, body)` | send a request as that user |
| `row(table, id)`, `count(table, where)` | read what is **really** in MySQL |
| `makeExpired(claimId)` | sets `expires_at` to 1 minute ago (pretend 48 hours passed) |
| **`checkInvariants()`** | 5 SQL checks that must find **no** broken rows: stock sums add up, need sums add up, every claim has one CLAIM_HELD, every cancelled/expired claim has exactly one give-back entry, history numbers are 1..N |

The app connects as the **limited** `givegrid_app` account during tests, exactly as when it runs.
Root (`adminDb`) is only used to reset and to set up special situations.

## 4. Key tests

**The 70 + 70 race test** (`6-concurrency`): two claims of 70 on 100, sent with
`Promise.all([...])` so they really overlap. Expect one 201, one 409 with `offer: 30`, available 30,
total claimed 70 (never 140), one CLAIM_HELD entry, invariants hold.

**Why `Promise.all` and not two browser windows:** humans can't click at the same millisecond, so
two windows usually test "one after the other", which even broken code passes (the professor's feedback).
`Promise.all` starts every request before waiting for any of them.

**Stress test:** 100 claims of 2 units on 100 units at once, repeated 3 times on fresh data. Exactly
50 succeed, 50 get 409, zero 500s (no crash, no deadlock), 0 left, invariants hold.

**Rollback test** (`5-database`): `jest.spyOn(events, 'addEvent')` makes the *last* step of a claim
fail. By then the claim has already lowered both counters and inserted its row. Afterwards: stock still
100, need still 50, 0 claims, only 1 history row. That proves BEGIN/ROLLBACK works.

**Append-only tests** (`5-database`): as `givegrid_app`, UPDATE/DELETE/TRUNCATE on history → "command
denied". As root, UPDATE/DELETE → the trigger's "append-only" error. Then: the row is unchanged and
INSERT still works.

**Proof the tests detect the bug:** remove `FOR UPDATE` from `createClaim` → 5 of 9 concurrency tests fail.

**Performance** (`7-performance`): loads the same 10,272 rows as `npm run seed`, checks > 5,000 rows,
times 5 busy requests (limit 300 ms; really a few ms), and uses `EXPLAIN` to check the matching and
expiry queries use our indexes.

## 5. Manual checklist (UAT / end-to-end, about 5 minutes)

After `npm run seed` and `npm start`:
1. Log in as **donor@givegrid.local** → list 30 "stools" (Furniture, Delhi, Saket). It appears with 30/30.
2. Log out, log in as **ngo@givegrid.local** → post a need for 60 stools, HIGH. "Find donations".
3. Claim 60 on your stools donation → yellow box "Only 30 can be reserved right now". Nothing reserved yet.
4. Accept 30 → "Reserved 30 … confirm before <date in 2 days>".
5. Dashboard → "Confirm pickup plan". Log in as donor → "Record pickup". As NGO → "Mark delivered", "Confirm receipt".
6. Open the donation → history shows 6 numbered steps with names and times.
7. Log in as **admin@givegrid.local** → verify a pending NGO.
8. Log in as **ngo10@givegrid.local** → sees "Waiting for an administrator" (it's PENDING).
9. Stop MySQL and reload a page → lists show a red error instead of hanging (error state).

## 6. Coverage

`npm run test:coverage` prints 4 numbers per file:
**Statements** (lines of code run), **Branches** (each side of every `if` taken), **Functions** (called
at least once), **Lines**. Ours: **93% lines, 82% branches**. The uncovered parts are mostly error
branches like "database unreachable" and the seed script's command-line part.

## 7. Every test (latest run)

```text

tests/1-unit.test.js  (27)
  ✓ decideClaim (what to do with a claim) › enough stock and enough need -> RESERVE
  ✓ decideClaim (what to do with a claim) › asking for more than is free -> COUNTER with what is free
  ✓ decideClaim (what to do with a claim) › the offer is also limited by what the NGO still needs
  ✓ decideClaim (what to do with a claim) › nothing free -> NOTHING (we never offer 0)
  ✓ decideClaim (what to do with a claim) › need already fully covered -> NOTHING
  ✓ decideClaim (what to do with a claim) › asking for exactly what is free -> RESERVE
  ✓ STEPS (the life of a claim) › a hold lasts 48 hours
  ✓ STEPS (the life of a claim) › only cancel gives items back (pickup and later steps never do)
  ✓ STEPS (the life of a claim) › cancelling is only possible before pickup
  ✓ STEPS (the life of a claim) › the donor records pickup; the NGO does every other step
  ✓ STEPS (the life of a claim) › the steps go in order: HELD -> CONFIRMED -> PICKED_UP -> DELIVERED -> RECEIVED
  ✓ validate (checking input from outside) › quantity accepts whole numbers from 1
  ✓ validate (checking input from outside) › quantity rejects 0
  ✓ validate (checking input from outside) › quantity rejects -3
  ✓ validate (checking input from outside) › quantity rejects 2.5
  ✓ validate (checking input from outside) › quantity rejects "5"
  ✓ validate (checking input from outside) › quantity rejects null
  ✓ validate (checking input from outside) › quantity rejects undefined
  ✓ validate (checking input from outside) › quantity rejects 100001
  ✓ validate (checking input from outside) › text trims spaces and rejects empty text
  ✓ validate (checking input from outside) › text rejects text that is too long
  ✓ validate (checking input from outside) › optionalText turns empty into null
  ✓ validate (checking input from outside) › oneOf only allows listed values
  ✓ validate (checking input from outside) › id accepts "12" from a URL and rejects "abc" or 0
  ✓ validate (checking input from outside) › email is lowercased and must look like an email
  ✓ validate (checking input from outside) › password must be 8 to 72 characters (bcrypt ignores anything after 72 bytes)
  ✓ validate (checking input from outside) › a thrown validation error carries status 400

tests/2-smoke.test.js  (5)
  ✓ GET /api/health says the API is running
  ✓ GET /api/health/db says the database is connected
  ✓ the 11 categories are in the database
  ✓ the website (frontend) is served at /
  ✓ an unknown API address gives 404 JSON

tests/3-functional.test.js  (25)
  ✓ accounts › register creates an account and returns a token, never the password
  ✓ accounts › the password is stored as a bcrypt hash, not as plain text
  ✓ accounts › login works with the right password and the token works on /me
  ✓ NGO verification › a new NGO is PENDING, cannot post needs, and can after an admin verifies it
  ✓ NGO verification › the admin can list only PENDING NGOs
  ✓ donations and needs › posting a donation saves it with full stock and writes DONATION_POSTED history
  ✓ donations and needs › a donor sees their own donations with ?mine=true
  ✓ donations and needs › the owner can edit the title of a donation
  ✓ donations and needs › the needs board lists HIGH urgency before LOW
  ✓ donations and needs › a closed donation can no longer be claimed
  ✓ ranked matching › donations that cover the whole need and are nearby come first
  ✓ ranked matching › for a donor, HIGH urgency needs score higher
  ✓ claims (one at a time) › a claim reserves immediately: status HELD, 48-hour deadline, counters lowered
  ✓ claims (one at a time) › COUNTER-PROPOSAL: asking 60 when 30 are free offers 30 and changes NOTHING
  ✓ claims (one at a time) › accepting the counter-proposal = claiming the offered amount
  ✓ claims (one at a time) › an old offer is checked again: if someone took the stock meanwhile, it is refused
  ✓ claims (one at a time) › SPLIT DONATION: 100 chairs to three NGOs (40 + 40 + 20); a fourth gets nothing
  ✓ the life of a claim › HELD -> CONFIRMED -> PICKED_UP -> DELIVERED -> RECEIVED, all in the history in order
  ✓ the life of a claim › steps out of order are refused with 409
  ✓ the life of a claim › after pickup the items never go back to the donation (cancel is refused)
  ✓ the life of a claim › cancelling before pickup gives the items back ONCE; cancelling again is refused
  ✓ 48-hour expiry › an expired hold is released by the timer, and can no longer be confirmed
  ✓ 48-hour expiry › a CONFIRMED claim does not expire
  ✓ 48-hour expiry › the expiry shows in the history as done by GiveGrid (no person)
  ✓ my claims list › each person sees only the claims they are part of

tests/4-security.test.js  (29)
  ✓ who are you? (authentication -> 401) › no token at all is refused
  ✓ who are you? (authentication -> 401) › a token signed with the wrong secret (a forged ADMIN token) is refused
  ✓ who are you? (authentication -> 401) › an expired token is refused
  ✓ who are you? (authentication -> 401) › wrong password gives 401 with the same message as an unknown email
  ✓ are you allowed? (authorisation -> 403) › nobody can register as ADMIN
  ✓ are you allowed? (authorisation -> 403) › an NGO cannot verify itself (admin only)
  ✓ are you allowed? (authorisation -> 403) › an UNVERIFIED NGO cannot claim
  ✓ are you allowed? (authorisation -> 403) › a donor cannot claim, and an NGO cannot post donations
  ✓ are you allowed? (authorisation -> 403) › an NGO cannot claim using ANOTHER NGO's need
  ✓ are you allowed? (authorisation -> 403) › an NGO cannot confirm or cancel another NGO's claim
  ✓ are you allowed? (authorisation -> 403) › a donor cannot edit, close or record pickup on another donor's donation
  ✓ bad data (validation -> 400) › a donation with zero quantity is refused and nothing is saved
  ✓ bad data (validation -> 400) › a donation with negative quantity is refused and nothing is saved
  ✓ bad data (validation -> 400) › a donation with decimal quantity is refused and nothing is saved
  ✓ bad data (validation -> 400) › a donation with quantity sent as text is refused and nothing is saved
  ✓ bad data (validation -> 400) › a donation with empty title is refused and nothing is saved
  ✓ bad data (validation -> 400) › a donation with category that does not exist is refused and nothing is saved
  ✓ bad data (validation -> 400) › a claim with zero, negative or missing quantity is refused
  ✓ bad data (validation -> 400) › an id that is not a number gives 400; one that does not exist gives 404
  ✓ bad data (validation -> 400) › a body that is not valid JSON gives 400, not a crash
  ✓ bad data (validation -> 400) › extra fields are ignored (mass assignment): you cannot set your own status
  ✓ attacks on the data › SQL injection in the login email does not work, and the table survives
  ✓ attacks on the data › SQL injection in a text field is saved as plain text
  ✓ attacks on the data › the password hash never appears in any reply
  ✓ attacks on the data › a server error returns a plain message, never SQL or a stack trace
  ✓ extra protection layers › every reply carries the security headers, and does not say "Express"
  ✓ extra protection layers › after 5 wrong passwords, login is blocked with 429 (even with the right password)
  ✓ extra protection layers › the block is only for that email: other accounts can still log in
  ✓ extra protection layers › a body bigger than 10 kB is refused with 413

tests/5-database.test.js  (17)
  ✓ the schema › all 7 tables exist
  ✓ constraints refuse bad data (straight SQL, no API) › CHECK: total quantity must be more than 0
  ✓ constraints refuse bad data (straight SQL, no API) › CHECK: available can never be negative or more than the total
  ✓ constraints refuse bad data (straight SQL, no API) › CHECK: a role that is not DONOR/NGO/ADMIN is refused
  ✓ constraints refuse bad data (straight SQL, no API) › UNIQUE: two accounts with the same email are refused
  ✓ constraints refuse bad data (straight SQL, no API) › FOREIGN KEY: a donation by a user who does not exist is refused
  ✓ constraints refuse bad data (straight SQL, no API) › NOT NULL: a user without a password hash is refused
  ✓ APPEND-ONLY history: nobody can change or delete it › we really are connected as the limited app account
  ✓ APPEND-ONLY history: nobody can change or delete it › the app account cannot UPDATE history
  ✓ APPEND-ONLY history: nobody can change or delete it › the app account cannot DELETE history
  ✓ APPEND-ONLY history: nobody can change or delete it › the app account cannot TRUNCATE (wipe) history
  ✓ APPEND-ONLY history: nobody can change or delete it › even the ADMIN account is stopped by the trigger
  ✓ APPEND-ONLY history: nobody can change or delete it › after all those attempts the row is unchanged, and adding new rows still works
  ✓ APPEND-ONLY history: nobody can change or delete it › UNIQUE (donation_id, seq): two entries with the same number are refused
  ✓ APPEND-ONLY history: nobody can change or delete it › least privilege: the app account cannot delete ANY row, anywhere
  ✓ TRANSACTIONS: all or nothing › if a claim fails halfway, every change it made is undone (ROLLBACK)
  ✓ TRANSACTIONS: all or nothing › posting a donation saves the donation and its history together

tests/6-concurrency.test.js  (9)
  ✓ PROFESSOR'S TEST: two claims of 70 on 100 chairs at the same instant -> exactly one wins
  ✓ two NGOs accept the same counter-offer of 30 at once -> only one gets it
  ✓ split at the same instant: 40 + 40 + 20 of 100 -> all three succeed, 0 left
  ✓ STRESS run 1: 100 claims of 2 units on 100 units at once -> exactly 50 win
  ✓ STRESS run 2: 100 claims of 2 units on 100 units at once -> exactly 50 win
  ✓ STRESS run 3: 100 claims of 2 units on 100 units at once -> exactly 50 win
  ✓ expiry timer and a new claim at the same instant -> no double give-back, no over-claim
  ✓ five expiry runs at once release an expired hold exactly ONCE
  ✓ cancel and pickup at the same instant -> exactly one wins

tests/7-performance.test.js  (8)
  ✓ the database holds more than 5,000 rows
  ✓ ranked matches for a need reply in under 300 ms
  ✓ the needs board replies in under 300 ms
  ✓ the donations list replies in under 300 ms
  ✓ a donation's history replies in under 300 ms
  ✓ the expiry timer's check runs in under 300 ms
  ✓ matching uses the idx_donations_match index (not a full table scan)
  ✓ the expiry check uses the idx_alloc_expiry index

Tests: 120 passed of 120
```
