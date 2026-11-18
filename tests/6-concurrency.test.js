// =====================================================================
// 6. CONCURRENCY TESTS  —  THE HARD REQUIREMENT
// "Behave correctly when two people use it at the same instant."
//
// Clicking in two browser windows is not a reliable test: humans are never
// truly simultaneous. Instead, Promise.all() sends all the requests at once
// and waits for every reply. They really do overlap inside MySQL.
//
// After each race we check the DATABASE (not just the replies), with
// checkInvariants(): nothing negative, nothing given twice, history complete.
//
// To see these tests catch the bug: delete "FOR UPDATE" from the two lock
// queries in backend/services/claims.js (createClaim) and run them again.
// =====================================================================

const h = require('./helpers');
const { expireOldHolds } = require('../backend/services/claims');

beforeEach(h.resetDb);
afterAll(h.closeDb);

// How many replies had this status code?
function howMany(responses, status) {
  return responses.filter((res) => res.status === status).length;
}

test("PROFESSOR'S TEST: two claims of 70 on 100 chairs at the same instant -> exactly one wins", async () => {
  // Arrange
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const ngoA = await h.makeNgoWithNeed(70);
  const ngoB = await h.makeNgoWithNeed(70);

  // Act: both at once
  const replies = await Promise.all([
    h.claim(ngoA, donation.id, 70),
    h.claim(ngoB, donation.id, 70),
  ]);

  // Assert: one 201, one 409 offering the 30 that are left
  expect(howMany(replies, 201)).toBe(1);
  expect(howMany(replies, 409)).toBe(1);
  expect(replies.find((r) => r.status === 409).body.offer).toBe(30);

  expect((await h.row('donations', donation.id)).available_quantity).toBe(30);
  const [sum] = await h.adminDb.query('SELECT SUM(quantity) AS total FROM allocations');
  expect(Number(sum[0].total)).toBe(70);                                     // never 140
  expect(await h.count('donation_events', "action = 'CLAIM_HELD'")).toBe(1);
  await h.checkInvariants();
});

test('two NGOs accept the same counter-offer of 30 at once -> only one gets it', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 30);
  const ngoA = await h.makeNgoWithNeed(60);
  const ngoB = await h.makeNgoWithNeed(60);
  expect((await h.claim(ngoA, donation.id, 60)).body.offer).toBe(30);        // both are offered 30
  expect((await h.claim(ngoB, donation.id, 60)).body.offer).toBe(30);

  const replies = await Promise.all([h.claim(ngoA, donation.id, 30), h.claim(ngoB, donation.id, 30)]);

  expect(howMany(replies, 201)).toBe(1);
  expect(howMany(replies, 409)).toBe(1);
  expect((await h.row('donations', donation.id)).available_quantity).toBe(0);
  await h.checkInvariants();
});

test('split at the same instant: 40 + 40 + 20 of 100 -> all three succeed, 0 left', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const a = await h.makeNgoWithNeed(40);
  const b = await h.makeNgoWithNeed(40);
  const c = await h.makeNgoWithNeed(20);

  const replies = await Promise.all([h.claim(a, donation.id, 40), h.claim(b, donation.id, 40), h.claim(c, donation.id, 20)]);

  expect(howMany(replies, 201)).toBe(3);
  expect((await h.row('donations', donation.id)).available_quantity).toBe(0);
  await h.checkInvariants();
});

// test.each runs this 3 times on fresh data, because a race bug may only show up sometimes.
test.each([1, 2, 3])('STRESS run %i: 100 claims of 2 units on 100 units at once -> exactly 50 win', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const ngos = [];
  for (let i = 0; i < 100; i++) {
    ngos.push(await h.makeNgoWithNeed(2));
  }

  const replies = await Promise.all(ngos.map((ngo) => h.claim(ngo, donation.id, 2)));

  expect(howMany(replies, 201)).toBe(50);
  expect(howMany(replies, 409)).toBe(50);
  expect(howMany(replies, 500)).toBe(0);                                     // no crashes, no deadlocks
  expect((await h.row('donations', donation.id)).available_quantity).toBe(0);
  expect(await h.count('allocations')).toBe(50);
  await h.checkInvariants();
});

test('expiry timer and a new claim at the same instant -> no double give-back, no over-claim', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const oldNgo = await h.makeNgoWithNeed(70);
  const newNgo = await h.makeNgoWithNeed(70);
  const oldClaim = await h.claim(oldNgo, donation.id, 70);                   // 30 left
  await h.makeExpired(oldClaim.body.id);

  const [expired, newClaim] = await Promise.all([expireOldHolds(), h.claim(newNgo, donation.id, 70)]);

  expect(expired).toBe(1);
  const left = (await h.row('donations', donation.id)).available_quantity;
  if (newClaim.status === 201) {
    expect(left).toBe(30);           // the expiry finished first: 70 came back, the new claim took them
  } else {
    expect(newClaim.body.offer).toBe(30);   // the claim locked first: it saw only 30
    expect(left).toBe(100);
  }
  await h.checkInvariants();
});

test('five expiry runs at once release an expired hold exactly ONCE', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const ngo = await h.makeNgoWithNeed(70);
  const held = await h.claim(ngo, donation.id, 70);
  await h.makeExpired(held.body.id);

  const counts = await Promise.all([expireOldHolds(), expireOldHolds(), expireOldHolds(), expireOldHolds(), expireOldHolds()]);

  expect(counts.reduce((total, n) => total + n, 0)).toBe(1);                 // only one run did it
  expect((await h.row('donations', donation.id)).available_quantity).toBe(100);   // not 170, not 450
  expect(await h.count('donation_events', "action = 'HOLD_EXPIRED'")).toBe(1);
  await h.checkInvariants();
});

test('cancel and pickup at the same instant -> exactly one wins', async () => {
  const donor = await h.makeUser('DONOR');
  const donation = await h.makeDonation(donor, 100);
  const ngo = await h.makeNgoWithNeed(40);
  const id = (await h.claim(ngo, donation.id, 40)).body.id;
  await h.post(`/api/claims/${id}/confirm`, ngo.user);

  const [cancel, pickup] = await Promise.all([
    h.post(`/api/claims/${id}/cancel`, ngo.user),
    h.post(`/api/claims/${id}/pickup`, donor),
  ]);

  expect([cancel.status, pickup.status].sort()).toEqual([200, 409]);
  const left = (await h.row('donations', donation.id)).available_quantity;
  expect(left).toBe(pickup.status === 200 ? 60 : 100);   // after pickup, items never come back
  await h.checkInvariants();
});
