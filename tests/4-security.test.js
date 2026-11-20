// =====================================================================
// 4. SECURITY TESTS  (validation + access control)
// The professor's rule: refuse invalid requests EVEN WHEN THEY BYPASS THE
// INTERFACE. Here we act like an attacker using Postman: no login, a fake
// token, the wrong account type, someone else's data, bad values, SQL
// injection. Every one must be refused, and the database must stay correct.
//   401 = we don't know who you are      403 = we know you, but you're not allowed
//   400 = the data you sent is wrong     404 = that thing does not exist
// =====================================================================

const jwt = require('jsonwebtoken');
const h = require('./helpers');

beforeEach(h.resetDb);
afterAll(h.closeDb);

describe('who are you? (authentication -> 401)', () => {
  test('no token at all is refused', async () => {
    const res = await h.request(h.app).get('/api/donations');
    expect(res.status).toBe(401);
  });

  test('a token signed with the wrong secret (a forged ADMIN token) is refused', async () => {
    const fake = jwt.sign({ id: 1, role: 'ADMIN' }, 'not-the-real-secret');
    const res = await h.request(h.app).get('/api/admin/ngos').set('Authorization', `Bearer ${fake}`);
    expect(res.status).toBe(401);
  });

  test('an expired token is refused', async () => {
    const old = jwt.sign({ id: 1, role: 'DONOR' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const res = await h.request(h.app).get('/api/donations').set('Authorization', `Bearer ${old}`);
    expect(res.status).toBe(401);
  });

  test('wrong password gives 401 with the same message as an unknown email', async () => {
    await h.request(h.app).post('/api/auth/register')
      .send({ name: 'A', email: 'a@test.local', password: 'password123', role: 'DONOR' });

    const wrongPassword = await h.request(h.app).post('/api/auth/login').send({ email: 'a@test.local', password: 'nope-nope' });
    const unknownEmail = await h.request(h.app).post('/api/auth/login').send({ email: 'z@test.local', password: 'nope-nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);   // no hint which emails exist
  });
});

describe('are you allowed? (authorisation -> 403)', () => {
  test('nobody can register as ADMIN', async () => {
    const res = await h.request(h.app).post('/api/auth/register')
      .send({ name: 'X', email: 'x@test.local', password: 'password123', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(await h.count('users')).toBe(0);
  });

  test('an NGO cannot verify itself (admin only)', async () => {
    const ngo = await h.makeNgoWithNeed(10, 'PENDING');
    const res = await h.patch('/api/admin/ngos/1/verification', ngo.user, { status: 'VERIFIED' });
    expect(res.status).toBe(403);
    expect((await h.row('ngos', 1)).status).toBe('PENDING');
  });

  test('an UNVERIFIED NGO cannot claim', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const pending = await h.makeNgoWithNeed(50, 'PENDING');

    const res = await h.claim(pending, donation.id, 10);

    expect(res.status).toBe(403);
    expect((await h.row('donations', donation.id)).available_quantity).toBe(100);
  });

  test('a donor cannot claim, and an NGO cannot post donations', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(50);

    expect((await h.post(`/api/donations/${donation.id}/claims`, donor, { need_id: ngo.needId, quantity: 5 })).status).toBe(403);
    expect((await h.post('/api/donations', ngo.user, { category_id: 1, title: 'X', total_quantity: 5, unit: 'x', city: 'Delhi' })).status).toBe(403);
  });

  test("an NGO cannot claim using ANOTHER NGO's need", async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const a = await h.makeNgoWithNeed(50);
    const b = await h.makeNgoWithNeed(50);

    const res = await h.post(`/api/donations/${donation.id}/claims`, a.user, { need_id: b.needId, quantity: 10 });
    expect(res.status).toBe(403);
  });

  test("an NGO cannot confirm or cancel another NGO's claim", async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const a = await h.makeNgoWithNeed(50);
    const b = await h.makeNgoWithNeed(50);
    const id = (await h.claim(a, donation.id, 10)).body.id;

    expect((await h.post(`/api/claims/${id}/confirm`, b.user)).status).toBe(403);
    expect((await h.post(`/api/claims/${id}/cancel`, b.user)).status).toBe(403);
    expect((await h.row('allocations', id)).status).toBe('HELD');
  });

  test("a donor cannot edit, close or record pickup on another donor's donation", async () => {
    const owner = await h.makeUser('DONOR');
    const other = await h.makeUser('DONOR');
    const donation = await h.makeDonation(owner, 100);
    const ngo = await h.makeNgoWithNeed(50);
    const id = (await h.claim(ngo, donation.id, 10)).body.id;
    await h.post(`/api/claims/${id}/confirm`, ngo.user);

    expect((await h.patch(`/api/donations/${donation.id}`, other, { title: 'Hacked' })).status).toBe(403);
    expect((await h.post(`/api/donations/${donation.id}/close`, other)).status).toBe(403);
    expect((await h.post(`/api/claims/${id}/pickup`, other)).status).toBe(403);
    expect((await h.row('donations', donation.id)).title).toBe('Office chairs');
  });
});

describe('bad data (validation -> 400)', () => {
  const good = { category_id: 1, title: 'Chairs', total_quantity: 10, unit: 'chairs', city: 'Delhi' };

  test.each([
    ['zero quantity', { total_quantity: 0 }],
    ['negative quantity', { total_quantity: -5 }],
    ['decimal quantity', { total_quantity: 2.5 }],
    ['quantity sent as text', { total_quantity: '10' }],
    ['empty title', { title: '   ' }],
    ['category that does not exist', { category_id: 999 }],
  ])('a donation with %s is refused and nothing is saved', async (label, change) => {
    const donor = await h.makeUser('DONOR');
    const res = await h.post('/api/donations', donor, { ...good, ...change });
    expect(res.status).toBe(400);
    expect(await h.count('donations')).toBe(0);
  });

  test('a claim with zero, negative or missing quantity is refused', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(50);

    expect((await h.claim(ngo, donation.id, 0)).status).toBe(400);
    expect((await h.claim(ngo, donation.id, -3)).status).toBe(400);
    expect((await h.post(`/api/donations/${donation.id}/claims`, ngo.user, { need_id: ngo.needId })).status).toBe(400);
    expect(await h.count('allocations')).toBe(0);
  });

  test('an id that is not a number gives 400; one that does not exist gives 404', async () => {
    const donor = await h.makeUser('DONOR');
    expect((await h.get('/api/donations/abc', donor)).status).toBe(400);
    expect((await h.get('/api/donations/99999', donor)).status).toBe(404);
  });

  test('a body that is not valid JSON gives 400, not a crash', async () => {
    const res = await h.request(h.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
  });

  test('extra fields are ignored (mass assignment): you cannot set your own status', async () => {
    const ngoUser = await h.makeUser('NGO');
    const res = await h.post('/api/ngos', ngoUser, { name: 'Sneaky NGO', city: 'Delhi', status: 'VERIFIED' });
    expect(res.body.status).toBe('PENDING');
  });
});

describe('attacks on the data', () => {
  test('SQL injection in the login email does not work, and the table survives', async () => {
    await h.makeUser('DONOR');
    const res = await h.request(h.app).post('/api/auth/login')
      .send({ email: "x'OR'1'='1@a.co", password: 'whatever1' });

    expect(res.status).toBe(401);                       // treated as plain text, not as SQL
    expect(await h.count('users')).toBe(1);
  });

  test('SQL injection in a text field is saved as plain text', async () => {
    const donor = await h.makeUser('DONOR');
    const evil = "Chairs'); DROP TABLE users; --";
    const donation = await h.makeDonation(donor, 5, { title: evil });

    expect(donation.title).toBe(evil);
    expect(await h.count('users')).toBe(1);             // users table still exists
  });

  test('the password hash never appears in any reply', async () => {
    const reg = await h.request(h.app).post('/api/auth/register')
      .send({ name: 'A', email: 'a@test.local', password: 'password123', role: 'DONOR' });
    const token = reg.body.token;
    const me = await h.request(h.app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    const donation = await h.makeDonation({ token }, 5);

    for (const body of [reg.body, me.body, donation]) {
      expect(JSON.stringify(body)).not.toMatch(/password|\$2[aby]\$/);
    }
  });

  test('a server error returns a plain message, never SQL or a stack trace', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});   // hide the expected log
    const spy = jest.spyOn(h.pool, 'query').mockRejectedValueOnce(new Error("Table 'givegrid_test.categories' is broken"));

    const res = await h.request(h.app).get('/api/categories');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Something went wrong on the server' });
    spy.mockRestore();
    quiet.mockRestore();
  });
});

describe('extra protection layers', () => {
  test('every reply carries the security headers, and does not say "Express"', async () => {
    for (const url of ['/api/health', '/']) {
      const res = await h.request(h.app).get(url);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  test('after 5 wrong passwords, login is blocked with 429 (even with the right password)', async () => {
    const account = { name: 'B', email: 'brute@test.local', password: 'password123', role: 'DONOR' };
    await h.request(h.app).post('/api/auth/register').send(account);

    for (let i = 0; i < 5; i++) {
      const wrong = await h.request(h.app).post('/api/auth/login').send({ email: account.email, password: 'guess-' + i });
      expect(wrong.status).toBe(401);
    }
    const blocked = await h.request(h.app).post('/api/auth/login').send({ email: account.email, password: account.password });
    expect(blocked.status).toBe(429);
  });

  test('the block is only for that email: other accounts can still log in', async () => {
    const other = { name: 'C', email: 'innocent@test.local', password: 'password123', role: 'DONOR' };
    await h.request(h.app).post('/api/auth/register').send(other);
    const res = await h.request(h.app).post('/api/auth/login').send({ email: other.email, password: other.password });
    expect(res.status).toBe(200);
  });

  test('a body bigger than 10 kB is refused with 413', async () => {
    const donor = await h.makeUser('DONOR');
    const res = await h.post('/api/donations', donor, { title: 'x'.repeat(20000) });
    expect(res.status).toBe(413);
  });
});
