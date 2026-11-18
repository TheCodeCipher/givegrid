// =====================================================================
// tests/helpers.js — shared tools for every test file.
// =====================================================================
// HOW OUR TESTS WORK
// * They run against a SEPARATE database, givegrid_test, never your real one.
// * They send real HTTP requests to the real app with Supertest:
//       await request(app).post('/api/...').send({...})
//   Supertest starts the app on a temporary port for each request, which is
//   why app.js must NOT call app.listen() itself.
// * The app talks to MySQL as the LIMITED account (givegrid_app), exactly like
//   when it runs normally. "adminDb" (root) is only used to reset tables and
//   to set up special situations, e.g. a claim whose 48 hours already passed.
// =====================================================================

const request = require('supertest');
const mysql = require('mysql2/promise');
const app = require('../backend/app');
const { pool } = require('../backend/db');
const { makeToken } = require('../backend/auth');
const config = require('../backend/config');
const { emptyTables } = require('../scripts/seed');

// Safety check: refuse to wipe anything except a database whose name ends in _test.
if (!config.db.testName.endsWith('_test')) {
  throw new Error('DB_TEST_NAME must end with _test, because the tests delete everything in it');
}

const adminDb = mysql.createPool({
  host: config.db.host, port: config.db.port,
  user: config.db.adminUser, password: config.db.adminPassword,
  database: config.db.testName,
});

// Empty all tables (categories stay). Called before each test so that every
// test starts from the same clean state and does not depend on another test.
async function resetDb() {
  const conn = await adminDb.getConnection();
  await emptyTables(conn);
  conn.release();
}

// Close both database pools at the end, so Jest can exit cleanly.
async function closeDb() {
  await pool.end();
  await adminDb.end();
}

// Create a user directly in the database and give back { id, token }.
// (Registering through the API is tested separately in 3-functional.test.js.)
let counter = 0;
async function makeUser(role) {
  counter = counter + 1;
  const [result] = await adminDb.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, 'not-a-real-hash', ?)",
    [`${role} ${counter}`, `user${counter}@test.local`, role]
  );
  const user = { id: result.insertId, role };
  return { id: user.id, token: makeToken(user) };
}

// An NGO account + its NGO profile + one need for `quantity` chairs in Delhi/Saket.
// status 'PENDING' makes an unverified NGO.
async function makeNgoWithNeed(quantity, status = 'VERIFIED') {
  const user = await makeUser('NGO');
  const [ngo] = await adminDb.query(
    "INSERT INTO ngos (user_id, name, city, locality, status) VALUES (?, ?, 'Delhi', 'Saket', ?)",
    [user.id, `NGO of user ${user.id}`, status]
  );
  const [need] = await adminDb.query(
    `INSERT INTO needs (ngo_id, category_id, title, quantity_required, remaining_quantity, unit, urgency, city, locality)
     VALUES (?, 1, 'Chairs for a classroom', ?, ?, 'chairs', 'HIGH', 'Delhi', 'Saket')`,
    [ngo.insertId, quantity, quantity]
  );
  return { user, needId: need.insertId };
}

// A donation of `quantity` chairs, created through the real API.
async function makeDonation(donor, quantity, extra = {}) {
  const res = await post('/api/donations', donor, {
    category_id: 1, title: 'Office chairs', total_quantity: quantity, unit: 'chairs',
    city: 'Delhi', locality: 'Saket', ...extra,
  });
  return res.body;
}

// Send requests as a logged-in user.
function post(url, user, body = {}) {
  return request(app).post(url).set('Authorization', `Bearer ${user.token}`).send(body);
}
function get(url, user) {
  return request(app).get(url).set('Authorization', `Bearer ${user.token}`);
}
function patch(url, user, body = {}) {
  return request(app).patch(url).set('Authorization', `Bearer ${user.token}`).send(body);
}

// An NGO claims `quantity` from a donation for its need.
function claim(ngo, donationId, quantity) {
  return post(`/api/donations/${donationId}/claims`, ngo.user, { need_id: ngo.needId, quantity });
}

// Read one row straight from the database (to check what was REALLY saved).
async function row(table, id) {
  const [rows] = await adminDb.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return rows[0];
}
async function count(table, where = '1 = 1') {
  const [rows] = await adminDb.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`);
  return rows[0].n;
}

// Pretend 48 hours have passed for this claim.
async function makeExpired(claimId) {
  await adminDb.query('UPDATE allocations SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [claimId]);
}

// ---------------------------------------------------------------------
// checkInvariants: the rules that must ALWAYS be true, whatever happened.
// Each query below looks for rows that BREAK a rule, so each must find none.
// ---------------------------------------------------------------------
async function checkInvariants() {
  // 1. For every donation:  available + (items held by live claims) = total
  const [badDonations] = await adminDb.query(
    `SELECT d.id FROM donations d
       LEFT JOIN allocations a ON a.donation_id = d.id AND a.status NOT IN ('CANCELLED', 'EXPIRED')
      GROUP BY d.id, d.available_quantity, d.total_quantity
     HAVING d.available_quantity + COALESCE(SUM(a.quantity), 0) <> d.total_quantity`
  );
  expect(badDonations).toEqual([]);

  // 2. For every need:  remaining + (items given by live claims) = required
  const [badNeeds] = await adminDb.query(
    `SELECT n.id FROM needs n
       LEFT JOIN allocations a ON a.need_id = n.id AND a.status NOT IN ('CANCELLED', 'EXPIRED')
      GROUP BY n.id, n.remaining_quantity, n.quantity_required
     HAVING n.remaining_quantity + COALESCE(SUM(a.quantity), 0) <> n.quantity_required`
  );
  expect(badNeeds).toEqual([]);

  // 3. Every claim has exactly one CLAIM_HELD history entry.
  const [badHeld] = await adminDb.query(
    `SELECT a.id FROM allocations a
       LEFT JOIN donation_events e ON e.allocation_id = a.id AND e.action = 'CLAIM_HELD'
      GROUP BY a.id HAVING COUNT(e.id) <> 1`
  );
  expect(badHeld).toEqual([]);

  // 4. A cancelled/expired claim has exactly ONE "gave back" entry; other claims have none.
  //    (If items were given back twice, there would be two.)
  const [badReleases] = await adminDb.query(
    `SELECT a.id FROM allocations a
       LEFT JOIN donation_events e ON e.allocation_id = a.id AND e.action IN ('CLAIM_CANCELLED', 'HOLD_EXPIRED')
      GROUP BY a.id, a.status
     HAVING COUNT(e.id) <> (CASE WHEN a.status IN ('CANCELLED', 'EXPIRED') THEN 1 ELSE 0 END)`
  );
  expect(badReleases).toEqual([]);

  // 5. History numbers of each donation are exactly 1, 2, 3 ... N (no gaps, no repeats).
  const [badSeq] = await adminDb.query(
    'SELECT donation_id FROM donation_events GROUP BY donation_id HAVING COUNT(*) <> MAX(seq) OR MIN(seq) <> 1'
  );
  expect(badSeq).toEqual([]);
}

module.exports = {
  request, app, pool, adminDb, resetDb, closeDb, makeUser, makeNgoWithNeed, makeDonation,
  post, get, patch, claim, row, count, makeExpired, checkInvariants,
};
