// =====================================================================
// 2. SMOKE TESTS
// The quickest check that the app is alive at all: does it start, reach
// the database, and serve the website? If these fail, nothing else matters.
// (Name from electronics: switch it on and see if smoke comes out.)
// =====================================================================

const h = require('./helpers');

afterAll(h.closeDb);

test('GET /api/health says the API is running', async () => {
  const res = await h.request(h.app).get('/api/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok', message: 'GiveGrid API is running' });
});

test('GET /api/health/db says the database is connected', async () => {
  const res = await h.request(h.app).get('/api/health/db');
  expect(res.status).toBe(200);
  expect(res.body.database).toBe('connected');
});

test('the 11 categories are in the database', async () => {
  const res = await h.request(h.app).get('/api/categories');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(11);
});

test('the website (frontend) is served at /', async () => {
  const res = await h.request(h.app).get('/');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/html/);
  expect(res.text).toContain('GiveGrid');
});

test('an unknown API address gives 404 JSON', async () => {
  const res = await h.request(h.app).get('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('Route not found');
});
