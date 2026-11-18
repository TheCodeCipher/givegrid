// =====================================================================
// services/events.js — the ONLY code that writes donation history.
// =====================================================================
// Every change to a donation or claim also adds one row here, INSIDE THE
// SAME TRANSACTION. So if the change is undone (ROLLBACK), its history
// row is undone too. History and data can never disagree.
//
// Rule for callers: you must already hold the lock on the donation row
// (SELECT ... FOR UPDATE). That lock means only one transaction at a time
// can be working out the next seq number for this donation.
// UNIQUE (donation_id, seq) in schema.sql is the final safety net.
// =====================================================================

async function addEvent(conn, { donationId, action, quantity = null, actorId = null, allocationId = null }) {
  // Next number = highest number so far + 1. (COALESCE turns "no rows yet" into 0.)
  const [rows] = await conn.query(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM donation_events WHERE donation_id = ?',
    [donationId]
  );

  await conn.query(
    `INSERT INTO donation_events (donation_id, seq, action, quantity, actor_id, allocation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [donationId, rows[0].nextSeq, action, quantity, actorId, allocationId]
  );
}

module.exports = { addEvent };
