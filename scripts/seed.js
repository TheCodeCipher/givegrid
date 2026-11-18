// =====================================================================
// scripts/seed.js   —   run with:  npm run seed
// =====================================================================
// Fills the database with demo accounts and MORE THAN 5,000 ROWS, so we
// can show GiveGrid stays fast with real-sized data (a course requirement).
//
// WARNING: empties the normal database (givegrid) first.
//
// Deterministic = no random numbers. Every value is worked out from the
// loop counter i, so every run creates exactly the same data.
//
// The function seedData() is also used by tests/7-performance.test.js.
// =====================================================================

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../backend/config');

const DONORS = 200;
const NGOS = 200;           // every 10th one is left PENDING (not verified)
const DONATIONS = 2500;
const NEEDS = 2500;
const CLAIMS = 600;
const PASSWORD = 'password123';

// One typical item per category, in the same order as the categories in schema.sql (ids 1-11).
const ITEMS = [
  ['Office chairs', 'chairs'], ['LED monitors', 'monitors'], ['Laptops', 'laptops'],
  ['Winter jackets', 'jackets'], ['Story books', 'books'], ['Notebooks', 'notebooks'],
  ['Cement bags', 'bags'], ['Filing cabinets', 'cabinets'], ['Folding tables', 'tables'],
  ['Blankets', 'blankets'], ['Ceiling fans', 'fans'],
];
const CITIES = [['Delhi', 'Saket'], ['Delhi', 'Rohini'], ['Mumbai', 'Andheri'], ['Kolkata', 'Salt Lake'], ['Bengaluru', 'Whitefield']];
const URGENCIES = ['LOW', 'MEDIUM', 'HIGH'];
// Seeded claims are spread over these statuses. Each status lists the history it implies.
const CLAIM_HISTORY = {
  HELD: ['CLAIM_HELD'],
  CONFIRMED: ['CLAIM_HELD', 'HOLD_CONFIRMED'],
  PICKED_UP: ['CLAIM_HELD', 'HOLD_CONFIRMED', 'PICKED_UP'],
  RECEIVED: ['CLAIM_HELD', 'HOLD_CONFIRMED', 'PICKED_UP', 'DELIVERED', 'RECEIPT_CONFIRMED'],
  CANCELLED: ['CLAIM_HELD', 'CLAIM_CANCELLED'],
};
const CLAIM_STATUSES = Object.keys(CLAIM_HISTORY);

// Empties every table except categories (fixed reference data).
// TRUNCATE wipes a whole table at once. It does NOT run the "no delete"
// trigger (that only fires for DELETE). Only the ADMIN account can do it:
// the app account has no permission to TRUNCATE (see scripts/setup.js).
async function emptyTables(conn) {
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');    // allow emptying tables that point at each other
  for (const table of ['donation_events', 'allocations', 'needs', 'donations', 'ngos', 'users']) {
    await conn.query(`TRUNCATE TABLE ${table}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');
}

// "Bulk insert": one INSERT with many rows ( VALUES ? with an array of arrays ).
// Thousands of separate INSERTs would be much slower.
// Returns the id of the first row; the rest follow 1, 2, 3... after it.
async function bulkInsert(conn, table, columns, rows) {
  const [result] = await conn.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ?`, [rows]);
  return result.insertId;
}

async function seedData(conn) {
  await emptyTables(conn);
  const hash = await bcrypt.hash(PASSWORD, 10);      // hash once, reuse for every demo account

  // ---- users: 1 admin, then donors, then NGO accounts ----
  const users = [['Demo Admin', 'admin@givegrid.local', hash, 'ADMIN']];
  for (let i = 1; i <= DONORS; i++) {
    users.push([`Donor ${i}`, i === 1 ? 'donor@givegrid.local' : `donor${i}@givegrid.local`, hash, 'DONOR']);
  }
  for (let i = 1; i <= NGOS; i++) {
    users.push([`NGO User ${i}`, i === 1 ? 'ngo@givegrid.local' : `ngo${i}@givegrid.local`, hash, 'NGO']);
  }
  const firstUserId = await bulkInsert(conn, 'users', ['name', 'email', 'password_hash', 'role'], users);
  const firstDonorId = firstUserId + 1;                 // right after the admin
  const firstNgoUserId = firstUserId + 1 + DONORS;      // right after the donors

  // ---- ngos ----
  const ngos = [];
  for (let i = 0; i < NGOS; i++) {
    const [city, locality] = CITIES[i % CITIES.length];
    const status = (i + 1) % 10 === 0 ? 'PENDING' : 'VERIFIED';
    ngos.push([firstNgoUserId + i, `NGO ${i + 1}`, city, locality, status]);
  }
  const firstNgoId = await bulkInsert(conn, 'ngos', ['user_id', 'name', 'city', 'locality', 'status'], ngos);
  const verifiedNgoIds = ngos.map((ngo, i) => (ngo[4] === 'VERIFIED' ? firstNgoId + i : null)).filter((x) => x !== null);

  // ---- donations (full stock for now; corrected after the claims below) ----
  const donations = [];
  for (let i = 0; i < DONATIONS; i++) {
    const [title, unit] = ITEMS[i % ITEMS.length];
    const [city, locality] = CITIES[i % CITIES.length];
    const total = 20 + ((i * 7) % 181);                 // 20 .. 200
    donations.push([firstDonorId + (i % DONORS), (i % ITEMS.length) + 1, `${title} #${i + 1}`, total, total, unit, city, locality]);
  }
  const firstDonationId = await bulkInsert(conn, 'donations',
    ['donor_id', 'category_id', 'title', 'total_quantity', 'available_quantity', 'unit', 'city', 'locality'], donations);

  // ---- needs (only verified NGOs post needs) ----
  const needs = [];
  for (let i = 0; i < NEEDS; i++) {
    const [title, unit] = ITEMS[i % ITEMS.length];
    const [city, locality] = CITIES[(i + 1) % CITIES.length];
    const required = 10 + ((i * 13) % 111);             // 10 .. 120
    needs.push([verifiedNgoIds[i % verifiedNgoIds.length], (i % ITEMS.length) + 1, `${title} needed #${i + 1}`,
      required, required, unit, URGENCIES[Math.floor(i / 7) % 3], city, locality]);
  }
  const firstNeedId = await bulkInsert(conn, 'needs',
    ['ngo_id', 'category_id', 'title', 'quantity_required', 'remaining_quantity', 'unit', 'urgency', 'city', 'locality'], needs);

  // ---- claims: donation i -> need i (same category and unit, because both use item i % 11) ----
  const claims = [];
  for (let i = 0; i < CLAIMS; i++) {
    claims.push([firstDonationId + i, firstNeedId + i, 1 + (i % 10), CLAIM_STATUSES[i % CLAIM_STATUSES.length]]);
  }
  // DATE_ADD can't go inside a bulk VALUES list, so the deadline is set with one UPDATE after.
  const firstClaimId = await bulkInsert(conn, 'allocations', ['donation_id', 'need_id', 'quantity', 'status', 'expires_at'],
    claims.map((c) => [...c, new Date(Date.now() + 48 * 3600 * 1000)]));

  // ---- history: every donation gets DONATION_POSTED (seq 1); claims add more ----
  const eventRows = donations.map((d, i) => [firstDonationId + i, 1, 'DONATION_POSTED', d[3], d[0], null]);
  claims.forEach((c, i) => {
    CLAIM_HISTORY[c[3]].forEach((action, step) => {
      // The donor records pickup; every other step is done by the NGO that owns need i.
      const ngoUserOfNeed = firstNgoUserId + (needs[i][0] - firstNgoId);
      const actor = action === 'PICKED_UP' ? donations[i][0] : ngoUserOfNeed;
      eventRows.push([c[0], step + 2, action, c[2], actor, firstClaimId + i]);
    });
  });
  await bulkInsert(conn, 'donation_events', ['donation_id', 'seq', 'action', 'quantity', 'actor_id', 'allocation_id'], eventRows);

  // ---- make the counters match the claims (using a JOIN in an UPDATE) ----
  // available = total - everything still used by claims that are not CANCELLED/EXPIRED.
  await conn.query(
    `UPDATE donations d
       JOIN (SELECT donation_id, SUM(quantity) AS used FROM allocations
              WHERE status NOT IN ('CANCELLED', 'EXPIRED') GROUP BY donation_id) a
         ON a.donation_id = d.id
        SET d.available_quantity = d.total_quantity - a.used`
  );
  await conn.query(
    `UPDATE needs n
       JOIN (SELECT need_id, SUM(quantity) AS used FROM allocations
              WHERE status NOT IN ('CANCELLED', 'EXPIRED') GROUP BY need_id) a
         ON a.need_id = n.id
        SET n.remaining_quantity = n.quantity_required - a.used`
  );

  // Refresh MySQL's statistics so it picks good indexes for the new data.
  for (const table of ['users', 'ngos', 'donations', 'needs', 'allocations', 'donation_events']) {
    await conn.query(`ANALYZE TABLE ${table}`);
  }

  // Count every table and return the numbers.
  const counts = {};
  let total = 0;
  for (const table of ['users', 'ngos', 'categories', 'donations', 'needs', 'allocations', 'donation_events']) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
    counts[table] = rows[0].n;
    total = total + rows[0].n;
  }
  counts.TOTAL = total;
  return counts;
}

// This part only runs when you type "npm run seed" (not when a test imports the file).
// require.main === module means "this file was started directly".
if (require.main === module) {
  (async () => {
    const conn = await mysql.createConnection({
      host: config.db.host, port: config.db.port,
      user: config.db.adminUser, password: config.db.adminPassword, database: config.db.name,
    });
    console.table(await seedData(conn));
    console.log(`Demo logins (password "${PASSWORD}"): admin@givegrid.local, donor@givegrid.local, ngo@givegrid.local`);
    console.log('An unverified NGO to try: ngo10@givegrid.local');
    await conn.end();
  })().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
}

module.exports = { seedData, emptyTables };
