// =====================================================================
// 7. PERFORMANCE TESTS
// Requirement: "handle at least 5,000 rows without slowing down".
// We load the same 10,000+ rows as "npm run seed" into the test database,
// then time the busiest requests and check MySQL uses our indexes.
//
// The time limit (300 ms) is generous on purpose: a slow laptop should
// still pass. On our machine these replies took a few milliseconds.
// =====================================================================

const h = require('./helpers');
const { seedData } = require('../scripts/seed');
const { expireOldHolds } = require('../backend/services/claims');

const LIMIT_MS = 300;
let ngo;     // a seeded NGO account that has needs

beforeAll(async () => {
  const conn = await h.adminDb.getConnection();
  await seedData(conn);
  conn.release();
  // ngo@givegrid.local is NGO user 1 in the seed; make a token for it.
  const [rows] = await h.adminDb.query("SELECT id FROM users WHERE email = 'ngo@givegrid.local'");
  ngo = { token: require('../backend/auth').makeToken({ id: rows[0].id, role: 'NGO' }) };
});
afterAll(h.closeDb);

// Runs a request and returns how many milliseconds it took.
async function timeIt(makeRequest) {
  const start = Date.now();
  const res = await makeRequest();
  expect(res.status).toBe(200);
  return Date.now() - start;
}

test('the database holds more than 5,000 rows', async () => {
  let total = 0;
  for (const table of ['users', 'ngos', 'categories', 'donations', 'needs', 'allocations', 'donation_events']) {
    total = total + (await h.count(table));
  }
  expect(total).toBeGreaterThan(5000);
});

test(`ranked matches for a need reply in under ${LIMIT_MS} ms`, async () => {
  expect(await timeIt(() => h.get('/api/needs/1/matches', ngo))).toBeLessThan(LIMIT_MS);
});

test(`the needs board replies in under ${LIMIT_MS} ms`, async () => {
  expect(await timeIt(() => h.get('/api/needs', ngo))).toBeLessThan(LIMIT_MS);
});

test(`the donations list replies in under ${LIMIT_MS} ms`, async () => {
  expect(await timeIt(() => h.get('/api/donations?limit=20', ngo))).toBeLessThan(LIMIT_MS);
});

test(`a donation's history replies in under ${LIMIT_MS} ms`, async () => {
  expect(await timeIt(() => h.get('/api/donations/1/events', ngo))).toBeLessThan(LIMIT_MS);
});

test(`the expiry timer's check runs in under ${LIMIT_MS} ms`, async () => {
  const start = Date.now();
  await expireOldHolds();
  expect(Date.now() - start).toBeLessThan(LIMIT_MS);
});

// EXPLAIN shows HOW MySQL will run a query. "key" = the index it uses.
test('matching uses the idx_donations_match index (not a full table scan)', async () => {
  const [plan] = await h.adminDb.query(
    `EXPLAIN SELECT d.id FROM needs n
       JOIN donations d ON d.category_id = n.category_id AND d.unit = n.unit
      WHERE n.id = 1 AND d.status = 'OPEN'`
  );
  const donationsStep = plan.find((step) => step.table === 'd');
  expect(donationsStep.key).toBe('idx_donations_match');
});

test('the expiry check uses the idx_alloc_expiry index', async () => {
  const [plan] = await h.adminDb.query(
    "EXPLAIN SELECT id FROM allocations WHERE status = 'HELD' AND expires_at <= NOW()"
  );
  expect(plan[0].key).toBe('idx_alloc_expiry');
});
