# Database

File: `database/schema.sql`. Created by `npm run setup`. MySQL 8, InnoDB engine.

**Why InnoDB?** It's the MySQL engine that supports the three things we need: **transactions**,
**row locks** and **foreign keys**.

---

## 1. The seven tables

```text
users ──< donations ──< allocations >── needs >── ngos ── users
  │           │               │
  │           └──< donation_events >──┘
  └────────────────────┘ (actor_id)
categories ──< donations, needs
```
`A ──< B` means "one A has many B" (B holds a foreign key to A).

| Table | One row is... | Key columns |
|---|---|---|
| `users` | an account | `email` UNIQUE, `password_hash`, `role` DONOR/NGO/ADMIN |
| `ngos` | an NGO profile | `user_id` UNIQUE (one per account), `status` PENDING/VERIFIED/REJECTED |
| `categories` | a kind of goods | `name` UNIQUE (11 rows, fixed) |
| `donations` | goods a donor offers | `total_quantity`, `available_quantity`, `unit`, `status` OPEN/CLOSED |
| `needs` | goods an NGO asks for | `quantity_required`, `remaining_quantity`, `urgency`, `status` |
| `allocations` | **a claim**: X items of one donation for one need | `quantity`, `status`, `expires_at` |
| `donation_events` | one line of a donation's history | `seq` 1, 2, 3…, `action`, `actor_id` |

**Many-to-many.** One donation can be split across many needs; one need can be filled by many
donations. A many-to-many relationship always needs a link table in between: that's `allocations`.

**Normalisation (why the tables are split this way).** Each fact is stored once. The NGO's name is
in `ngos` only; a need stores `ngo_id`, not the name. If the name changes, it changes in one place.
No column holds a list (e.g. no "claimed_by: 3,7,9"); lists become rows in `allocations`.
That's 1NF (one value per cell), 2NF and 3NF (every column depends only on its own table's key).

## 2. The quantities (the most important idea)

Two numbers on each side:

| | Never changes | Changes |
|---|---|---|
| donation | `total_quantity` (what the donor offered) | `available_quantity` (what is still free) |
| need | `quantity_required` (what the NGO asked for) | `remaining_quantity` (what it still needs) |

Example:
```text
Donation: total 100, available 100       Need: required 50, remaining 50
NGO claims 40   -> available 60,  remaining 10,  claim (40, HELD)
Claim expires   -> available 100, remaining 50,  claim (40, EXPIRED)
```

**The rule that must always be true** (we call these *invariants*):
```text
available_quantity + (quantity of the donation's live claims) = total_quantity
remaining_quantity + (quantity of the need's live claims)     = quantity_required
```
"Live" = every status except CANCELLED and EXPIRED.

A CHECK constraint can only look at **one row**, so MySQL cannot check a sum across rows by itself.
Our transactions keep it true, and `checkInvariants()` in `tests/helpers.js` proves it after the tests.

## 3. The life of a claim (`allocations.status`)

```text
HELD ──confirm──> CONFIRMED ──pickup──> PICKED_UP ──deliver──> DELIVERED ──receipt──> RECEIVED
  │                   │
  ├──48h pass──> EXPIRED        (items go back)
  └──cancel──> CANCELLED <──cancel──┘   (items go back)
```
- **Items used:** HELD, CONFIRMED, PICKED_UP, DELIVERED, RECEIVED.
- **Items given back:** CANCELLED, EXPIRED.
- After PICKED_UP the goods have physically left, so they never return to stock.
- The same rules as a table, in code: `STEPS` in `backend/rules.js`.

## 4. Every constraint and why

| Constraint | Where | What it stops |
|---|---|---|
| `PRIMARY KEY` + `AUTO_INCREMENT` | every `id` | two rows with the same id; MySQL picks the next number |
| `UNIQUE` | `users.email` | two accounts with one email |
| `UNIQUE` | `ngos.user_id` | one account owning two NGOs |
| `UNIQUE` | `categories.name` | duplicate categories |
| `UNIQUE (donation_id, seq)` | `donation_events` | two history lines with the same number |
| `NOT NULL` | most columns | missing required data |
| `DEFAULT` | `status`, `created_at` | sensible starting values (`PENDING`, `OPEN`, now) |
| `CHECK (role IN ...)` | users | made-up roles like SUPERUSER |
| `CHECK (total_quantity > 0)` | donations | zero/negative donations |
| `CHECK (available_quantity >= 0 AND available_quantity <= total_quantity)` | donations | **stock below 0 or above total**: the last safety net against over-allocation |
| `CHECK (remaining_quantity >= 0 AND ... <= quantity_required)` | needs | the same for needs; also stops a double give-back |
| `CHECK (status IN ...)`, `CHECK (urgency IN ...)`, `CHECK (action IN ...)` | several | made-up values |
| `FOREIGN KEY` | every `..._id` column | pointing at a row that doesn't exist |

Each one is tested in `tests/5-database.test.js` by inserting bad data with plain SQL.

**Why locks are still needed alongside the CHECK.** The CHECK only stops the number going **negative**. Without locks, two claims of 30 on 30 available could both
read 30 and both write 0: no negative number, but 60 promised from 30. The CHECK can't see the
other claim. The lock is what serialises them; the CHECK is a backup.

## 5. Append-only history: three layers

`donation_events` can be added to but never changed. Three independent layers:

| Layer | How | Stops |
|---|---|---|
| 1. Privileges | The app logs in as `givegrid_app`, which has only `SELECT, INSERT` on this table (`scripts/setup.js`) | the app account: UPDATE, DELETE, TRUNCATE all → "command denied" |
| 2. Triggers | `BEFORE UPDATE` / `BEFORE DELETE` → `SIGNAL SQLSTATE '45000'` raises an error (`schema.sql`) | **every** account, even root, for UPDATE/DELETE |
| 3. `UNIQUE (donation_id, seq)` | each donation's history is numbered 1, 2, 3 with no repeats | duplicate or confused history |

Real output, as the app account:
```text
mysql> UPDATE donation_events SET action='X' WHERE id=1;
ERROR 1142: UPDATE command denied to user 'givegrid_app'@'localhost' for table 'donation_events'
mysql> DELETE FROM donation_events WHERE id=1;
ERROR 1142: DELETE command denied to user 'givegrid_app'@'localhost' for table 'donation_events'
mysql> TRUNCATE donation_events;
ERROR 1142: DROP command denied to user 'givegrid_app'@'localhost' for table 'donation_events'
```
As root, the trigger still says no:
```text
ERROR 1644 (45000): donation_events is append-only: DELETE is not allowed
```

**Limits:**
- `TRUNCATE` doesn't fire triggers (it wipes the table without deleting rows one by one). Only
  privileges stop it. Root can still truncate, which is how the tests reset the database.
- Root can also `DROP TRIGGER`. Nothing stops an administrator; that's why the app never uses root.

**Least privilege:** the app account has no DELETE on **any** table, because the app never deletes
rows. Categories are read-only for it. If someone stole the app's password, they still couldn't
erase data or history.

## 6. Indexes, with evidence

**What an index is:** a sorted lookup structure, like a book's index. Without one, MySQL reads
every row ("full table scan"). With one, it jumps to the matching rows.

**MySQL makes some automatically:** for every PRIMARY KEY, every UNIQUE, and every FOREIGN KEY
column. So `donor_id`, `ngo_id`, `donation_id`, `need_id` are already indexed.

**We added three** (bottom of `schema.sql`), each for one real query:

| Index | Query it serves | EXPLAIN without → with |
|---|---|---|
| `idx_alloc_expiry (status, expires_at)` | expiry timer: `WHERE status='HELD' AND expires_at <= NOW()` | `type ALL`, all 600 claims read → `type range, rows 1, key idx_alloc_expiry` |
| `idx_donations_match (category_id, unit)` | matching: donations with the need's category and unit | `key idx_donations_match, rows 227` of 2,500. It also serves the `category_id` foreign key; adding `unit` lets MySQL skip same-category donations in another unit |
| `idx_needs_match (category_id, unit)` | matching the other way | same idea |

How to read EXPLAIN: **`key`** = the index used (NULL = none). **`type`**: `ALL` = read every row
(slow), `ref`/`range` = used an index, `const` = found by primary key. **`rows`** = estimated rows read.

**One we tried and removed:** an index on `needs.status`. Almost every need is OPEN, so it didn't
narrow anything, and EXPLAIN showed MySQL ignored it. An index only helps if the column
separates rows well.

**Note:** MySQL refused to drop `idx_donations_match` because it's also serving the
`category_id` foreign key (MySQL reuses an index that starts with the foreign-key column).

**Measured:** with 10,272 rows every tested request replied in a few milliseconds
(`tests/7-performance.test.js` allows up to 300 ms to be safe on slow laptops).

## 7. Isolation level and locks (MySQL details)

- **Row lock:** `SELECT ... FOR UPDATE` inside a transaction locks those rows. Another transaction
  asking for the same lock **waits** until the first one COMMITs or ROLLBACKs.
- **Isolation level:** we use **READ COMMITTED** for our transactions (`db.js`): each normal SELECT
  sees the newest committed data. MySQL's default, REPEATABLE READ, can show an older snapshot;
  for counting the next history number we want the newest. Locked reads (`FOR UPDATE`) always see
  the newest data in either level.
- **Deadlock:** A waits for B while B waits for A. We avoid it by always locking in one order:
  **donation → need → claim**.
- **Privilege note:** `SELECT ... FOR UPDATE` needs UPDATE permission on that table. The app has it
  on donations/needs/allocations, and never locks `donation_events`.

## 8. Columns

**users:** `id`, `name`, `email` (lowercase, unique), `password_hash` (bcrypt, ~60 characters, starts
`$2`), `role`, `created_at`.
**ngos:** `id`, `user_id` (owner), `name`, `city`, `locality` (optional area), `status`, `created_at`.
**categories:** `id`, `name`.
**donations:** `id`, `donor_id`, `category_id`, `title`, `description` (optional), `total_quantity`,
`available_quantity`, `unit` (lowercase so "Chairs" = "chairs"), `city`, `locality`, `status`, `created_at`.
**needs:** `id`, `ngo_id`, `category_id`, `title`, `quantity_required`, `remaining_quantity`, `unit`,
`urgency` LOW/MEDIUM/HIGH, `city`, `locality`, `status`, `created_at`.
**allocations:** `id`, `donation_id`, `need_id`, `quantity`, `status`, `created_at`, `expires_at`
(created + 48 h, worked out by MySQL's clock).
**donation_events:** `id`, `donation_id`, `seq`, `action` (one of 9), `quantity` (optional),
`actor_id` (NULL = the system did it), `allocation_id` (which claim it's about, optional), `created_at`.

The 9 history actions: DONATION_POSTED, DONATION_CLOSED, CLAIM_HELD, HOLD_CONFIRMED, HOLD_EXPIRED,
CLAIM_CANCELLED, PICKED_UP, DELIVERED, RECEIPT_CONFIRMED.

## 9. Setup and seed

- `npm run setup` (`scripts/setup.js`): as root → create the `givegrid_app` account → for both
  `givegrid` and `givegrid_test`: drop, create, run `schema.sql`, grant the limited permissions.
- `npm run seed` (`scripts/seed.js`): empties the tables, then bulk-inserts 401 users, 200 NGOs
  (every 10th PENDING), 2,500 donations, 2,500 needs, 600 claims and 4,060 history rows. No random
  numbers, so it's the same every time. The stock counters are then corrected with an
  `UPDATE ... JOIN (SELECT ... SUM ... GROUP BY)` so the invariants hold.
