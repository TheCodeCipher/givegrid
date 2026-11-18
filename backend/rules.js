// =====================================================================
// rules.js — GiveGrid's business rules, written as plain JavaScript.
// =====================================================================
// No database and no Express in here: just decisions. That makes the
// rules easy to read, easy to explain, and easy to unit test.
// =====================================================================

// How long a new claim is held before it expires if not confirmed.
const HOLD_HOURS = 48;

// ---------------------------------------------------------------------
// decideClaim: an NGO asks for "requested" items. Using the FRESH numbers
// read from the locked database rows, what should happen?
//
//   most we can give = the smaller of (items still free, items still needed)
//
//   most is 0          -> NOTHING  (no stock left, or need already covered)
//   requested > most   -> COUNTER  (offer "most" instead; reserve NOTHING yet)
//   otherwise          -> RESERVE  (reserve exactly what was asked)
// ---------------------------------------------------------------------
function decideClaim(requested, available, stillNeeded) {
  const most = Math.min(available, stillNeeded);
  if (most === 0) {
    return { result: 'NOTHING' };
  }
  if (requested > most) {
    return { result: 'COUNTER', offer: most };
  }
  return { result: 'RESERVE' };
}

// ---------------------------------------------------------------------
// STEPS: every way a claim can move forward, as one table.
//   who       = which kind of account may do it
//   from      = the statuses the claim must be in right now
//   to        = the status it moves to
//   event     = the history entry written for it
//   givesBack = true if the items return to the donation and the need
//   checkDeadline = true if it is refused once the 48 hours have passed
//
// Expiry is not here because no person does it: the timer does
// (see services/claims.js, expireOne).
// ---------------------------------------------------------------------
const STEPS = {
  confirm: { who: 'NGO',   from: ['HELD'],              to: 'CONFIRMED', event: 'HOLD_CONFIRMED',    checkDeadline: true },
  cancel:  { who: 'NGO',   from: ['HELD', 'CONFIRMED'], to: 'CANCELLED', event: 'CLAIM_CANCELLED',   givesBack: true },
  pickup:  { who: 'DONOR', from: ['CONFIRMED'],         to: 'PICKED_UP', event: 'PICKED_UP' },
  deliver: { who: 'NGO',   from: ['PICKED_UP'],         to: 'DELIVERED', event: 'DELIVERED' },
  receipt: { who: 'NGO',   from: ['DELIVERED'],         to: 'RECEIVED',  event: 'RECEIPT_CONFIRMED' },
};

module.exports = { HOLD_HOURS, decideClaim, STEPS };
