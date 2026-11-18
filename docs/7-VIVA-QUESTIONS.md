# Viva questions and answers

**How to use:** cover the answer, say yours out loud, then check. ★ = very likely to be asked.
Answers are short on purpose: say the answer, then point at the file. If they push, the
"If pushed" line is your next sentence.

---

## The hard requirement

**★ 1. What is your hard requirement?**
Concurrency: if two NGOs claim the same donation at the same instant, a naive version would let both
succeed and promise more than exists. We also have the other two kinds: a multi-row transaction
(a claim changes 4 rows together) and append-only history.

**★ 2. Why does the naive version fail?**
Both requests read "100 available" before either one writes. Both check 70 ≤ 100, both pass, both
save. 140 promised. It's a check-then-act race: the check and the write aren't one step.

**★ 3. How do you fix it?** (`backend/services/claims.js`, `createClaim`)
Inside a transaction, the first thing we do is `SELECT * FROM donations WHERE id = ? FOR UPDATE`. That
locks the donation row. The second claim's same SELECT **waits** until the first commits. Then it reads
the new value, 30, and gets a counter-proposal.
*If pushed:* only that one row is locked, so claims on other donations aren't slowed down.

**★ 4. How do you know it works?**
`tests/6-concurrency.test.js` sends two 70-chair claims with `Promise.all`, so they really overlap.
Exactly one gets 201, the other 409 with offer 30, 30 remain. And if I delete `FOR UPDATE`, 5 of the
9 concurrency tests fail. (Offer to show it.)

**★ 5. Why not test with two browser windows?**
People can't click at the same millisecond, so it usually tests "one after the other", which broken
code also passes. That was the professor's feedback on our first proposal. `Promise.all` starts all
requests before waiting for any.

**★ 6. What is a transaction?** (`backend/db.js`, `withTransaction`)
A group of changes that are saved together or not at all. BEGIN starts it, COMMIT saves everything,
ROLLBACK undoes everything. A claim makes four writes: donation stock, need, the claim row, the history row.
*If pushed:* the test "if a claim fails halfway" makes the last step fail on purpose and checks nothing was saved.

**★ 7. You have a CHECK `available_quantity >= 0`. Why do you still need locks?**
The CHECK only stops negative numbers. Two claims of 30 on 30 could both read 30 and both write 0: never
negative, but 60 promised. A CHECK can't see the other transaction. The lock makes them take turns; the
CHECK is the last safety net.

**8. What's a deadlock and how do you avoid it?**
A waits for a lock B holds, while B waits for one A holds; both wait forever. We always lock in the same
order: donation → need → claim. Then a cycle can't form. MySQL would detect a deadlock and cancel one
transaction, but we never get there; the stress test with 100 simultaneous claims has zero 500s.

**9. Which isolation level and why?**
READ COMMITTED for our transactions (set in `withTransaction`). Each normal SELECT sees the newest
committed data, which matters when we count the next history number. Locked reads (`FOR UPDATE`) always
see the newest data anyway. MySQL's default is REPEATABLE READ.

**10. Why not just `UPDATE donations SET available = available - 70 WHERE id = ? AND available >= 70`?**
That works for one counter in one statement. But we also need the need's remaining quantity, the claim
row, the next history number, and the exact counter-proposal amount, all from consistent numbers. One
lock on the donation covers all of that and is easier to reason about.

## Counter-proposal and holds

**★ 11. What happens if an NGO asks for more than is available?**
The server replies 409 with `offer` = the smaller of (still available, still needed). **Nothing is reserved.**
The NGO accepts by sending a new claim for that amount; the server locks and checks again.

**★ 12. Why doesn't the offer reserve anything?**
If offers held stock, an NGO that never answers would block it. And the offer is a `throw` before any
write, so the transaction rolls back with nothing changed.

**13. Two NGOs both see "offer 30" and both accept at once?**
Both acceptances are normal claims; the lock makes them take turns. The first gets 30, the second sees 0
and gets 409. Tested.

**14. Why is there no "accept offer" endpoint?**
The offer isn't stored anywhere, so there's nothing to accept. Accepting is just claiming the offered
amount, which goes through every check again. Simpler and safe against stale offers.

**★ 15. How does the 48-hour expiry work?** (`expireOldHolds`, `expireOne`)
Every minute `server.js` runs `expireOldHolds`. It finds HELD claims past `expires_at` (without locks),
then for each one starts a transaction, locks it, and checks **again** that it's still HELD and still
expired. Only then it gives the items back and writes HOLD_EXPIRED.

**★ 16. How do you guarantee items are given back only once?**
The re-check under lock. A second expiry run, or a cancel at the same moment, waits for the lock, then
sees the status is no longer HELD and does nothing. Tested with five expiry runs at the same time: one expiry, stock 100 not 170.

**17. Expiry and a new claim at the same instant?**
Both need the donation lock, so one goes first. Either the 70 come back first and the new claim takes
them, or the claim sees only 30 and is offered 30. Both outcomes are correct; over-allocation is impossible. Tested.

**18. Cancel and pickup at the same instant?**
Both lock the claim and check its status. Pickup needs CONFIRMED; cancel needs HELD or CONFIRMED. The
second one sees the status the first set and gets 409. Items never come back after pickup. Tested.

**19. Why is `expires_at` set with `NOW()` in SQL?**
One clock (the database's) for everyone. Browser or server clocks could disagree.

## History (append-only)

**★ 20. How is history protected?** (`schema.sql`, `scripts/setup.js`)
Three layers in MySQL itself: (1) the app's account only has SELECT and INSERT on `donation_events`;
(2) triggers refuse every UPDATE and DELETE, even from root; (3) `UNIQUE (donation_id, seq)`.

**21. Show me it works.**
Log in as `givegrid_app` in MySQL and try `UPDATE donation_events ...` → "UPDATE command denied". The
tests in `5-database.test.js` do exactly this, as the real app account, not as root.

**22. Can anyone get around it?**
An administrator (root) can still TRUNCATE (it doesn't fire triggers) or drop the trigger. That's why
the app never logs in as root. Nothing can stop the database administrator; the goal is that the
application can't rewrite history even if it has a bug or its password leaks.

**23. Why both status columns and a history table?**
Status columns answer "what's true now" fast. History answers "what happened, who did it, when". They're
written in the same transaction, so they can't disagree.

**24. How is `seq` worked out safely?**
`MAX(seq) + 1` for that donation, while we hold the donation's lock, so only one transaction at a time
can do it. The UNIQUE constraint is the backup.

## Database

**★ 25. Explain your tables.** (`docs/2-DATABASE.md` §1)
users, ngos, categories, donations, needs, allocations (the claims, the many-to-many link between
donations and needs), donation_events (history). Draw it.

**26. Why is allocations needed?**
Donations and needs are many-to-many (one donation split across NGOs, one need filled by many donors).
Many-to-many needs a link table. Each row is "this many items of this donation for this need".

**27. Normalisation?**
Each fact is stored once (the NGO name only in `ngos`), no lists inside a column (claims are rows, not
"3,7,9"), and every column depends only on its own table's key. That's up to 3NF.

**★ 28. Name your constraints.**
PRIMARY KEY, UNIQUE (email, ngos.user_id, (donation_id, seq)), NOT NULL, FOREIGN KEY on every `_id`,
CHECK on quantities (> 0, 0 ≤ available ≤ total), roles, statuses, urgency, actions, DEFAULT on status and dates.

**★ 29. Which indexes and why?**
MySQL already indexes primary keys, UNIQUE columns and foreign keys. We added `(status, expires_at)` on
allocations for the expiry timer (EXPLAIN: 601 rows scanned → 1), and `(category_id, unit)` on donations
and needs for matching (MySQL reads only the ~227 matching donations of 2,500; the index also serves the category foreign key). We removed an index on `needs.status` because
almost every need is OPEN, so it didn't narrow anything.

**30. How do you meet "5,000 rows without slowing down"?**
`npm run seed` loads 10,272 rows. `7-performance.test.js` checks there are over 5,000 and that the busiest
requests reply in under 300 ms (they take a few ms) and use our indexes.

**31. Why MySQL and not MongoDB?**
The course guide disallows NoSQL for the project: we need transactions, row locks and constraints, which
is exactly what a relational database is built for.

**32. What does `npm run setup` do?**
As root: create the limited `givegrid_app` account; for both databases (normal and test): drop, create,
run `schema.sql`, then grant the app only SELECT/INSERT/UPDATE (no DELETE anywhere) and only
SELECT/INSERT on history.

## Backend and REST

**★ 33. Walk me through a request.** (`docs/3-BACKEND.md` §1)
fetch → `express.json()` → router by URL → `authenticate` (token → `req.user`) → `authorise` (role) →
handler validates input → service runs SQL in a transaction → `res.status(201).json(...)`. Errors jump
to the error handler.

**34. Why are `app.js` and `server.js` separate?**
Tests import the app and Supertest runs it on a temporary port. If `app.js` called `listen`, tests would
fight over port 3000 and not exit.

**35. How do errors work?**
We throw `HttpError(status, message)`. `asyncHandler` catches errors from async routes (Express 4 doesn't)
and passes them to the error handler (the 4-argument middleware). Unknown errors become a plain 500,
never SQL or a stack trace.

**★ 36. 401 vs 403?**
401: we don't know who you are (no or bad token). 403: we know you, but you're not allowed (wrong role,
or not your data, or NGO not verified).

**37. Why is a claim 409 and not 400?**
400 means the request itself is wrong (quantity −5). 409 means it's valid but clashes with the current
state (not enough stock right now, wrong status, expired hold).

**38. PUT vs PATCH?**
PUT replaces the whole resource; PATCH changes part of it. We only ever change some fields (title and
description, or status), so PATCH.

**39. Why `POST /claims/:id/confirm` and not PATCH status?**
Each step has its own rules, side effects (history, maybe stock) and allowed person. Separate actions
make that clear and stop clients setting any status they like.

**40. Why no DELETE routes?**
Nothing is deleted in GiveGrid; history must stay answerable. Closing and cancelling are status changes.
The app's database account has no DELETE permission at all.

## Security

**★ 41. How do you store passwords?**
`bcrypt.hash(password, 10)`: one-way, with a random salt, cost factor 10 so guessing is slow. Login uses
`bcrypt.compare`. The hash is never sent back.

**★ 42. What's in your JWT and why is it safe?**
`{ id, role, iat, exp }`, signed with HS256 and our secret. Anyone can read it, nobody can change it:
changing the role breaks the signature, so `jwt.verify` throws → 401. No secrets go in it.

**★ 43. How do you stop SQL injection?**
Every value goes through `?` placeholders, so mysql2 escapes it and it's always data, never SQL. Tested
with `x'OR'1'='1` in the email and `'); DROP TABLE users; --` in a title.

**44. What if someone sends `status: "VERIFIED"` when creating an NGO?**
Ignored. We pick fields one by one (no mass assignment); status comes from the database default, PENDING. Tested.

**45. Isn't hiding buttons in the frontend enough?**
No. Anyone can send requests with Postman. Every rule is checked on the server; the frontend just avoids
showing options that would fail. The security tests act exactly like Postman.

**46. CORS?**
Not needed: Express serves the frontend too, so pages and API share one origin. The browser only
enforces CORS across different origins.

**47. What would you add for production?**
`helmet` for security headers, rate limiting on login (429), HTTPS, and the token in an HttpOnly cookie
instead of localStorage. Mention them honestly; they're small additions.

## Testing

**★ 48. What kinds of tests do you have?** (`docs/4-TESTS.md` §1)
Unit (rules and validation alone), smoke (is it alive), functional/integration (features through API and
DB), security (attacks refused), database (constraints, append-only, rollback), concurrency (races),
performance (5,000+ rows, indexes). Regression = re-running all of them after each change.

**49. Unit vs integration?**
Unit tests one function alone, with no database, in milliseconds (`decideClaim`). Integration tests
several parts together: route + service + real MySQL (most of our tests).

**50. How do tests stay independent?**
`beforeEach(resetDb)` empties the tables before every test, and they run one file at a time (`--runInBand`)
on a separate `givegrid_test` database.

**51. What's `checkInvariants`?**
Five SQL queries that look for rows breaking our rules: stock sums, need sums, every claim has one
CLAIM_HELD, every cancel/expiry gave back exactly once, history numbered 1..N. Each must find nothing.

**52. What does coverage tell you?**
How much of the code the tests ran: statements, branches, functions, lines. Ours is 92% of lines. It
shows what's untested, not that the tested code is correct; that's what the assertions do.

## The frontend

**53. Why no React?**
The guide allows plain HTML/CSS/JS "and lose no marks", and it keeps the whole project in what we were taught.

**★ 54. Loading, error and empty states?**
Every list calls `showLoading`, then on failure `showError`, and `showTable` shows the empty message
when there are no items. (`frontend/js/common.js`)

**55. What does `esc()` do?**
Escapes `<`, `>`, `&`, quotes before putting text into HTML, so a donation titled `<script>` shows as
text instead of running (XSS).

---

## Demo (about 6 minutes)

Before: `npm run setup`, `npm run seed`, `npm start`, Postman open, a MySQL terminal open.

1. **Data size:** show the seed table (10,272 rows).
2. **The race:** `npx jest --runInBand tests/6-concurrency.test.js --verbose`. Point at the first test name.
3. **Break it (if they want proof):** remove `FOR UPDATE` in `createClaim`, rerun, ~5 fail, put it back.
4. **Browser:** as NGO, claim more than exists → yellow counter-proposal → Accept → "confirm before …".
5. **Lifecycle:** confirm → (donor) record pickup → (NGO) delivered → receipt → open the history (6 numbered steps).
6. **History is protected:** in MySQL as `givegrid_app`: `UPDATE donation_events SET action='X' WHERE id=1;` → denied.
7. **Postman:** folder 5, "Must be refused": 401, 400, 404, all refused without the website.
8. **Indexes:** `EXPLAIN SELECT id FROM allocations WHERE status='HELD' AND expires_at <= NOW();` → `key = idx_alloc_expiry`.

Commands for step 6:
```bash
mysql -u givegrid_app -p givegrid
```
```sql
UPDATE donation_events SET action = 'X' WHERE id = 1;
DELETE FROM donation_events WHERE id = 1;
```
