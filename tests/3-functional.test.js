// =====================================================================
// 3. FUNCTIONAL TESTS  (also called INTEGRATION tests)
// Does each FEATURE do what a user expects, from the request all the way
// to the database and back? Every test sends real HTTP requests (Supertest)
// and then checks both the reply AND what was really saved in MySQL.
//
// Each test follows Arrange - Act - Assert:
//   Arrange: create the users/donations it needs
//   Act:     send the request being tested
//   Assert:  check the reply and the database
// =====================================================================

const h = require('./helpers');
const { expireOldHolds } = require('../backend/services/claims');

beforeEach(h.resetDb);       // every test starts with empty tables
afterAll(h.closeDb);

describe('accounts', () => {
  const asha = { name: 'Asha', email: 'asha@test.local', password: 'password123', role: 'DONOR' };

  test('register creates an account and returns a token, never the password', async () => {
    const res = await h.request(h.app).post('/api/auth/register').send(asha);

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toEqual({ id: 1, name: 'Asha', email: 'asha@test.local', role: 'DONOR' });
  });

  test('the password is stored as a bcrypt hash, not as plain text', async () => {
    await h.request(h.app).post('/api/auth/register').send(asha);

    const user = await h.row('users', 1);
    expect(user.password_hash).not.toBe('password123');
    expect(user.password_hash.startsWith('$2')).toBe(true);    // every bcrypt hash starts with $2
  });

  test('login works with the right password and the token works on /me', async () => {
    await h.request(h.app).post('/api/auth/register').send(asha);

    const login = await h.request(h.app).post('/api/auth/login').send({ email: asha.email, password: asha.password });
    expect(login.status).toBe(200);

    const me = await h.request(h.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.body.email).toBe('asha@test.local');
  });
});

describe('NGO verification', () => {
  test('a new NGO is PENDING, cannot post needs, and can after an admin verifies it', async () => {
    const admin = await h.makeUser('ADMIN');
    const ngoUser = await h.makeUser('NGO');
    const need = { category_id: 1, title: 'Desks', quantity_required: 20, unit: 'desks', urgency: 'HIGH', city: 'Delhi' };

    const created = await h.post('/api/ngos', ngoUser, { name: 'Helping Hands', city: 'Delhi' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');

    expect((await h.post('/api/needs', ngoUser, need)).status).toBe(403);       // not verified yet

    const verify = await h.patch(`/api/admin/ngos/${created.body.id}/verification`, admin, { status: 'VERIFIED' });
    expect(verify.body.status).toBe('VERIFIED');

    expect((await h.post('/api/needs', ngoUser, need)).status).toBe(201);       // now allowed
  });

  test('the admin can list only PENDING NGOs', async () => {
    const admin = await h.makeUser('ADMIN');
    await h.makeNgoWithNeed(10, 'PENDING');
    await h.makeNgoWithNeed(10, 'VERIFIED');

    const res = await h.get('/api/admin/ngos?status=PENDING', admin);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('PENDING');
  });
});

describe('donations and needs', () => {
  test('posting a donation saves it with full stock and writes DONATION_POSTED history', async () => {
    const donor = await h.makeUser('DONOR');

    const res = await h.post('/api/donations', donor, {
      category_id: 1, title: 'Chairs', total_quantity: 100, unit: 'Chairs', city: 'Delhi',
    });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/donations/${res.body.id}`);
    expect(res.body.available_quantity).toBe(100);
    expect(res.body.unit).toBe('chairs');                                        // stored lowercase
    const history = await h.get(`/api/donations/${res.body.id}/events`, donor);
    expect(history.body.map((e) => e.action)).toEqual(['DONATION_POSTED']);
  });

  test('a donor sees their own donations with ?mine=true', async () => {
    const donor = await h.makeUser('DONOR');
    const other = await h.makeUser('DONOR');
    await h.makeDonation(donor, 10);
    await h.makeDonation(other, 10);

    const res = await h.get('/api/donations?mine=true', donor);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].donor_id).toBe(donor.id);
  });

  test('the owner can edit the title of a donation', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 10);

    const res = await h.patch(`/api/donations/${donation.id}`, donor, { title: 'Stackable chairs' });
    expect(res.status).toBe(200);
    expect((await h.row('donations', donation.id)).title).toBe('Stackable chairs');
  });

  test('the needs board lists HIGH urgency before LOW', async () => {
    const donor = await h.makeUser('DONOR');
    const low = await h.makeNgoWithNeed(10);
    await h.adminDb.query("UPDATE needs SET urgency = 'LOW' WHERE id = ?", [low.needId]);
    const high = await h.makeNgoWithNeed(10);                                   // HIGH by default

    const res = await h.get('/api/needs', donor);
    expect(res.body.map((n) => n.id)).toEqual([high.needId, low.needId]);
  });

  test('a closed donation can no longer be claimed', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(50);

    await h.post(`/api/donations/${donation.id}/close`, donor);
    const res = await h.claim(ngo, donation.id, 10);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This donation is closed');
  });
});

describe('ranked matching', () => {
  test('donations that cover the whole need and are nearby come first', async () => {
    const donor = await h.makeUser('DONOR');
    const ngo = await h.makeNgoWithNeed(50);                                    // 50 chairs, Delhi / Saket
    await h.makeDonation(donor, 10, { title: 'Far and small', city: 'Mumbai', locality: '' });
    await h.makeDonation(donor, 80, { title: 'Same city, enough', locality: 'Rohini' });
    await h.makeDonation(donor, 60, { title: 'Same area, enough' });
    await h.makeDonation(donor, 500, { title: 'Wrong category', category_id: 2 });

    const res = await h.get(`/api/needs/${ngo.needId}/matches`, ngo.user);

    expect(res.body.map((d) => d.title)).toEqual(['Same area, enough', 'Same city, enough', 'Far and small']);
    expect(res.body.map((d) => d.score)).toEqual([50, 40, 0]);                  // 30+20, 30+10, 0+0
  });

  test('for a donor, HIGH urgency needs score higher', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const urgent = await h.makeNgoWithNeed(10);                                 // HIGH
    const calm = await h.makeNgoWithNeed(10);
    await h.adminDb.query("UPDATE needs SET urgency = 'LOW' WHERE id = ?", [calm.needId]);

    const res = await h.get(`/api/donations/${donation.id}/matching-needs`, donor);
    expect(res.body[0].id).toBe(urgent.needId);
    expect(res.body[0].score).toBe(80);                                         // 30 urgency + 30 covers + 20 area
  });
});

describe('claims (one at a time)', () => {
  test('a claim reserves immediately: status HELD, 48-hour deadline, counters lowered', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(50);

    const res = await h.claim(ngo, donation.id, 40);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('HELD');
    const hours = (new Date(res.body.expires_at) - new Date(res.body.created_at)) / (60 * 60 * 1000);
    expect(hours).toBe(48);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(60);
    expect((await h.row('needs', ngo.needId)).remaining_quantity).toBe(10);
    await h.checkInvariants();
  });

  test('COUNTER-PROPOSAL: asking 60 when 30 are free offers 30 and changes NOTHING', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 30);
    const ngo = await h.makeNgoWithNeed(60);

    const offer = await h.claim(ngo, donation.id, 60);

    expect(offer.status).toBe(409);
    expect(offer.body.offer).toBe(30);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(30);   // nothing reserved
    expect((await h.row('needs', ngo.needId)).remaining_quantity).toBe(60);
    expect(await h.count('allocations')).toBe(0);
  });

  test('accepting the counter-proposal = claiming the offered amount', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 30);
    const ngo = await h.makeNgoWithNeed(60);
    const offer = await h.claim(ngo, donation.id, 60);

    const accepted = await h.claim(ngo, donation.id, offer.body.offer);

    expect(accepted.status).toBe(201);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(0);
    await h.checkInvariants();
  });

  test('an old offer is checked again: if someone took the stock meanwhile, it is refused', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 30);
    const slow = await h.makeNgoWithNeed(60);
    const fast = await h.makeNgoWithNeed(30);
    await h.claim(slow, donation.id, 60);              // slow NGO is offered 30...
    await h.claim(fast, donation.id, 30);              // ...but the fast one takes all 30 first

    const late = await h.claim(slow, donation.id, 30);

    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/Nothing can be reserved/);
    await h.checkInvariants();
  });

  test('SPLIT DONATION: 100 chairs to three NGOs (40 + 40 + 20); a fourth gets nothing', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const a = await h.makeNgoWithNeed(40);
    const b = await h.makeNgoWithNeed(40);
    const c = await h.makeNgoWithNeed(20);
    const d = await h.makeNgoWithNeed(10);

    expect((await h.claim(a, donation.id, 40)).status).toBe(201);
    expect((await h.claim(b, donation.id, 40)).status).toBe(201);
    expect((await h.claim(c, donation.id, 20)).status).toBe(201);
    expect((await h.claim(d, donation.id, 10)).status).toBe(409);

    expect((await h.row('donations', donation.id)).available_quantity).toBe(0);
    await h.checkInvariants();
  });
});

describe('the life of a claim', () => {
  test('HELD -> CONFIRMED -> PICKED_UP -> DELIVERED -> RECEIVED, all in the history in order', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;

    expect((await h.post(`/api/claims/${id}/confirm`, ngo.user)).body.status).toBe('CONFIRMED');
    expect((await h.post(`/api/claims/${id}/pickup`, donor)).body.status).toBe('PICKED_UP');
    expect((await h.post(`/api/claims/${id}/deliver`, ngo.user)).body.status).toBe('DELIVERED');
    expect((await h.post(`/api/claims/${id}/receipt`, ngo.user)).body.status).toBe('RECEIVED');

    const history = await h.get(`/api/donations/${donation.id}/events`, donor);
    expect(history.body.map((e) => e.action)).toEqual([
      'DONATION_POSTED', 'CLAIM_HELD', 'HOLD_CONFIRMED', 'PICKED_UP', 'DELIVERED', 'RECEIPT_CONFIRMED',
    ]);
    expect(history.body.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    await h.checkInvariants();
  });

  test('steps out of order are refused with 409', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;

    const pickupTooEarly = await h.post(`/api/claims/${id}/pickup`, donor);       // not CONFIRMED yet
    expect(pickupTooEarly.status).toBe(409);
    expect(pickupTooEarly.body.error).toBe('Cannot pickup a claim that is HELD');
  });

  test('after pickup the items never go back to the donation (cancel is refused)', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;
    await h.post(`/api/claims/${id}/confirm`, ngo.user);
    await h.post(`/api/claims/${id}/pickup`, donor);

    expect((await h.post(`/api/claims/${id}/cancel`, ngo.user)).status).toBe(409);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(60);
  });

  test('cancelling before pickup gives the items back ONCE; cancelling again is refused', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;

    expect((await h.post(`/api/claims/${id}/cancel`, ngo.user)).status).toBe(200);
    expect((await h.post(`/api/claims/${id}/cancel`, ngo.user)).status).toBe(409);

    expect((await h.row('donations', donation.id)).available_quantity).toBe(100);   // not 140
    expect((await h.row('needs', ngo.needId)).remaining_quantity).toBe(40);
    await h.checkInvariants();
  });
});

describe('48-hour expiry', () => {
  test('an expired hold is released by the timer, and can no longer be confirmed', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;
    await h.makeExpired(id);

    // The deadline counts even before the timer runs.
    const lateConfirm = await h.post(`/api/claims/${id}/confirm`, ngo.user);
    expect(lateConfirm.status).toBe(409);

    expect(await expireOldHolds()).toBe(1);
    expect(await expireOldHolds()).toBe(0);                                      // second run: nothing left
    expect((await h.row('allocations', id)).status).toBe('EXPIRED');
    expect((await h.row('donations', donation.id)).available_quantity).toBe(100);
    await h.checkInvariants();
  });

  test('a CONFIRMED claim does not expire', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;
    await h.post(`/api/claims/${id}/confirm`, ngo.user);
    await h.makeExpired(id);

    expect(await expireOldHolds()).toBe(0);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(60);
  });

  test('the expiry shows in the history as done by GiveGrid (no person)', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(40);
    const id = (await h.claim(ngo, donation.id, 40)).body.id;
    await h.makeExpired(id);
    await expireOldHolds();

    const history = await h.get(`/api/donations/${donation.id}/events`, donor);
    const last = history.body[history.body.length - 1];
    expect(last.action).toBe('HOLD_EXPIRED');
    expect(last.actor_name).toBeNull();
  });
});

describe('my claims list', () => {
  test('each person sees only the claims they are part of', async () => {
    const donor = await h.makeUser('DONOR');
    const stranger = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngoA = await h.makeNgoWithNeed(50);
    const ngoB = await h.makeNgoWithNeed(50);
    await h.claim(ngoA, donation.id, 10);

    expect((await h.get('/api/claims', donor)).body).toHaveLength(1);
    expect((await h.get('/api/claims', ngoA.user)).body).toHaveLength(1);
    expect((await h.get('/api/claims', ngoB.user)).body).toHaveLength(0);
    expect((await h.get('/api/claims', stranger)).body).toHaveLength(0);
  });
});
