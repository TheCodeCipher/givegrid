// =====================================================================
// services/claims.js — THE HARD REQUIREMENT LIVES HERE.
// =====================================================================
// Problem: 100 chairs. Two NGOs each ask for 70 at the same instant.
// Naive code: both read "100 available", both say "70 <= 100, OK",
// both save. Result: 140 chairs promised. Impossible.
//
// Our fix, in every function below:
//   1. Start a transaction.
//   2. LOCK the rows we will change with SELECT ... FOR UPDATE.
//      A second transaction asking for the same lock WAITS here.
//   3. Only after locking, read the numbers and decide.
//   4. Write all changes, then COMMIT (which releases the locks).
// The waiting NGO then reads the NEW numbers (30 left) and gets an offer of 30.
//
// LOCK ORDER (always the same, everywhere): donation -> need -> allocation.
// If two transactions always lock in the same order they can never end up
// each waiting for the other forever (a "deadlock").
// =====================================================================

const { pool, withTransaction } = require('../db');
const { HttpError } = require('../errors');
const rules = require('../rules');
const events = require('./events');   // used as events.addEvent so tests can fake a failure

// ---------------------------------------------------------------------
// createClaim: NGO user asks for "quantity" items of a donation, for one of their needs.
// Returns the new claim, or throws 409 with an "offer" (the counter-proposal).
// ---------------------------------------------------------------------
async function createClaim(user, donationId, needId, quantity) {
  return withTransaction(async (conn) => {
    // ---- 1. Lock the donation row. Competing claims queue up here. ----
    const [donationRows] = await conn.query('SELECT * FROM donations WHERE id = ? FOR UPDATE', [donationId]);
    const donation = donationRows[0];
    if (!donation) {
      throw new HttpError(404, 'Donation not found');
    }

    // ---- 2. Lock the need row (second in the lock order). ----
    const [needRows] = await conn.query('SELECT * FROM needs WHERE id = ? FOR UPDATE', [needId]);
    const need = needRows[0];
    if (!need) {
      throw new HttpError(404, 'Need not found');
    }

    // ---- 3. Check every rule on the server, with the rows we just locked. ----
    const [ngoRows] = await conn.query('SELECT user_id, status FROM ngos WHERE id = ?', [need.ngo_id]);
    const ngo = ngoRows[0];
    if (ngo.user_id !== user.id) {
      throw new HttpError(403, 'You can only claim for your own NGO needs');
    }
    if (ngo.status !== 'VERIFIED') {
      throw new HttpError(403, 'Only verified NGOs can claim donations');
    }
    if (donation.status !== 'OPEN') {
      throw new HttpError(409, 'This donation is closed');
    }
    if (need.status !== 'OPEN') {
      throw new HttpError(409, 'This need is closed');
    }
    if (donation.category_id !== need.category_id || donation.unit !== need.unit) {
      throw new HttpError(400, 'The donation and the need must have the same category and unit');
    }

    // ---- 4. Decide, using the FRESH locked numbers (never numbers from the browser). ----
    const decision = rules.decideClaim(quantity, donation.available_quantity, need.remaining_quantity);

    if (decision.result === 'NOTHING') {
      throw new HttpError(409, 'Nothing can be reserved: no stock left, or your need is already covered');
    }
    if (decision.result === 'COUNTER') {
      // COUNTER-PROPOSAL. Throwing here makes withTransaction ROLLBACK, and we have
      // written nothing anyway, so NOTHING is reserved. To accept, the NGO simply
      // sends a new claim for the offered amount, and all of these checks run again.
      throw new HttpError(409, `Only ${decision.offer} can be reserved right now`, {
        offer: decision.offer,
        available: donation.available_quantity,
        stillNeeded: need.remaining_quantity,
      });
    }

    // ---- 5. RESERVE: four writes that succeed together or not at all. ----
    await conn.query('UPDATE donations SET available_quantity = available_quantity - ? WHERE id = ?', [quantity, donationId]);
    await conn.query('UPDATE needs SET remaining_quantity = remaining_quantity - ? WHERE id = ?', [quantity, needId]);

    // The deadline uses the DATABASE clock: NOW() + 48 hours.
    const [insert] = await conn.query(
      `INSERT INTO allocations (donation_id, need_id, quantity, status, expires_at)
       VALUES (?, ?, ?, 'HELD', DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [donationId, needId, quantity, rules.HOLD_HOURS]
    );

    await events.addEvent(conn, {
      donationId,
      action: 'CLAIM_HELD',
      quantity,
      actorId: user.id,
      allocationId: insert.insertId,       // insertId = the id MySQL just gave the new claim
    });

    const [claimRows] = await conn.query('SELECT * FROM allocations WHERE id = ?', [insert.insertId]);
    return claimRows[0];
  });                                       // <- COMMIT happens here (inside withTransaction)
}

// ---------------------------------------------------------------------
// lockClaim: locks donation -> need -> claim (the agreed order) and returns
// the claim with its CURRENT status, plus who owns it.
// ---------------------------------------------------------------------
async function lockClaim(conn, claimId) {
  // First, a plain read just to learn WHICH donation and need to lock.
  // These two ids never change, so reading them without a lock is safe.
  const [found] = await conn.query('SELECT donation_id, need_id FROM allocations WHERE id = ?', [claimId]);
  if (!found[0]) {
    throw new HttpError(404, 'Claim not found');
  }

  await conn.query('SELECT id FROM donations WHERE id = ? FOR UPDATE', [found[0].donation_id]);
  await conn.query('SELECT id FROM needs WHERE id = ? FOR UPDATE', [found[0].need_id]);

  // Now lock the claim itself and read its status as it is RIGHT NOW.
  // is_expired is worked out by MySQL's clock: 1 = deadline passed, 0 = not yet.
  const [claimRows] = await conn.query(
    'SELECT *, (expires_at <= NOW()) AS is_expired FROM allocations WHERE id = ? FOR UPDATE',
    [claimId]
  );
  const claim = claimRows[0];

  // Who owns the donation and who owns the need (for permission checks).
  const [owners] = await conn.query(
    `SELECT d.donor_id, g.user_id AS ngo_user_id
       FROM donations d, needs n, ngos g
      WHERE d.id = ? AND n.id = ? AND g.id = n.ngo_id`,
    [claim.donation_id, claim.need_id]
  );
  claim.donor_id = owners[0].donor_id;
  claim.ngo_user_id = owners[0].ngo_user_id;
  return claim;
}

// Puts the claim's items back into the donation and the need.
// Only ever called AFTER the status was checked under lock.
async function giveBack(conn, claim) {
  await conn.query('UPDATE donations SET available_quantity = available_quantity + ? WHERE id = ?', [claim.quantity, claim.donation_id]);
  await conn.query('UPDATE needs SET remaining_quantity = remaining_quantity + ? WHERE id = ?', [claim.quantity, claim.need_id]);
}

// ---------------------------------------------------------------------
// changeClaim: confirm / cancel / pickup / deliver / receipt.
// The rules for each one are in rules.STEPS (one table, easy to read).
// ---------------------------------------------------------------------
async function changeClaim(user, claimId, stepName) {
  const step = rules.STEPS[stepName];

  return withTransaction(async (conn) => {
    const claim = await lockClaim(conn, claimId);

    // Is this person allowed? (NGO steps: the NGO that made the claim. Pickup: the donor.)
    const ownerId = step.who === 'NGO' ? claim.ngo_user_id : claim.donor_id;
    if (ownerId !== user.id) {
      throw new HttpError(403, 'This claim does not belong to you');
    }

    // Is the claim in the right status RIGHT NOW? Checked under lock, so if a
    // cancel and a pickup race, only the first one can pass this check.
    if (!step.from.includes(claim.status)) {
      throw new HttpError(409, `Cannot ${stepName} a claim that is ${claim.status}`);
    }
    if (step.checkDeadline && claim.is_expired) {
      throw new HttpError(409, 'The 48-hour hold has expired, so it can no longer be confirmed');
    }

    if (step.givesBack) {
      await giveBack(conn, claim);
    }
    await conn.query('UPDATE allocations SET status = ? WHERE id = ?', [step.to, claimId]);
    await events.addEvent(conn, {
      donationId: claim.donation_id,
      action: step.event,
      quantity: claim.quantity,
      actorId: user.id,
      allocationId: claimId,
    });

    const [rows] = await conn.query('SELECT * FROM allocations WHERE id = ?', [claimId]);
    return rows[0];
  });
}

// ---------------------------------------------------------------------
// expireOne: HELD -> EXPIRED for one claim. Returns true if it expired it.
// It re-checks status AND deadline under lock. If someone confirmed or
// cancelled it a moment ago, or another expiry run already did it, this
// does nothing. That is why the items are given back AT MOST ONCE.
// ---------------------------------------------------------------------
async function expireOne(claimId) {
  return withTransaction(async (conn) => {
    const claim = await lockClaim(conn, claimId);
    if (claim.status !== 'HELD' || !claim.is_expired) {
      return false;
    }
    await giveBack(conn, claim);
    await conn.query("UPDATE allocations SET status = 'EXPIRED' WHERE id = ?", [claimId]);
    await events.addEvent(conn, {
      donationId: claim.donation_id,
      action: 'HOLD_EXPIRED',
      quantity: claim.quantity,
      actorId: null,                        // NULL = done by GiveGrid, not a person
      allocationId: claimId,
    });
    return true;
  });
}

// The expiry timer calls this every minute (see server.js).
// Step 1 finds candidates WITHOUT locking. Step 2 handles each one in its own
// transaction, where it is locked and checked again (so an old list is harmless).
async function expireOldHolds() {
  const [candidates] = await pool.query(
    "SELECT id FROM allocations WHERE status = 'HELD' AND expires_at <= NOW() ORDER BY id"
  );
  let count = 0;
  for (const row of candidates) {
    if (await expireOne(row.id)) {
      count = count + 1;
    }
  }
  return count;
}

// ---------------------------------------------------------------------
// listClaims: the claims a person is part of.
// NGO: claims made for its needs.  DONOR: claims on their donations.  ADMIN: all.
// ---------------------------------------------------------------------
async function listClaims(user) {
  const [rows] = await pool.query(
    `SELECT a.id, a.donation_id, a.need_id, a.quantity, a.status, a.created_at, a.expires_at,
            d.title AS donation_title, d.unit, n.title AS need_title, g.name AS ngo_name
       FROM allocations a
       JOIN donations d ON d.id = a.donation_id
       JOIN needs n     ON n.id = a.need_id
       JOIN ngos g      ON g.id = n.ngo_id
      WHERE ? = 'ADMIN'
         OR (? = 'DONOR' AND d.donor_id = ?)
         OR (? = 'NGO' AND g.user_id = ?)
      ORDER BY a.id DESC
      LIMIT 100`,
    [user.role, user.role, user.id, user.role, user.id]
  );
  return rows;
}

module.exports = { createClaim, changeClaim, expireOne, expireOldHolds, listClaims };
