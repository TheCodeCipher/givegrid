// =====================================================================
// scripts/setup.js   —   run with:  npm run setup
// =====================================================================
// Builds the database from nothing. Run it once after installing, and
// again whenever you want a completely fresh start.
//
// WARNING: it DELETES both databases (givegrid and givegrid_test) first.
//
// What it does, in order:
//   1. Logs in to MySQL as the ADMIN account from .env (usually root).
//   2. Creates the limited account the app will use (givegrid_app).
//   3. For each database (normal + test):
//        drop it, create it, run database/schema.sql inside it,
//        then give givegrid_app ONLY the permissions it needs.
// =====================================================================

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../backend/config');

// The tables the app can read, add to, and change. (No DELETE anywhere:
// the app never deletes rows, so it is not allowed to.)
const NORMAL_TABLES = ['users', 'ngos', 'donations', 'needs', 'allocations'];

async function main() {
  // multipleStatements: true lets us send the whole schema.sql file at once.
  const admin = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.adminUser,
    password: config.db.adminPassword,
    multipleStatements: true,
    ssl: config.db.ssl,
  });

  const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  const appUser = config.db.appUser;
  const appHost = config.db.appHost;
  // Step 2: create the app account (or reset its password if it exists).
  // The ? are filled in safely by mysql2 (same as in every other query).
  await admin.query("CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?", [appUser, appHost, config.db.appPassword]);
  await admin.query("ALTER USER ?@? IDENTIFIED BY ?", [appUser, appHost, config.db.appPassword]);

  for (const dbName of [config.db.name, config.db.testName]) {
    // Step 3a: brand-new empty database.
    await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await admin.query(`CREATE DATABASE \`${dbName}\``);
    await admin.query(`USE \`${dbName}\``);

    // Step 3b: create all tables, triggers, indexes and categories.
    await admin.query(schema);

    // Step 3c: LEAST PRIVILEGE. The app gets only what it needs.
    for (const table of NORMAL_TABLES) {
      await admin.query(`GRANT SELECT, INSERT, UPDATE ON \`${dbName}\`.${table} TO ?@?`, [appUser, appHost]);
    }
    // Categories are fixed reference data: read only.
    await admin.query(`GRANT SELECT ON \`${dbName}\`.categories TO ?@?`, [appUser, appHost]);
    // History: read and ADD only. No UPDATE, no DELETE, no DROP (DROP is what
    // TRUNCATE needs in MySQL). This is layer 2 of "append-only".
    await admin.query(`GRANT SELECT, INSERT ON \`${dbName}\`.donation_events TO ?@?`, [appUser, appHost]);

    console.log(`Created database "${dbName}" with 7 tables`);
  }

  console.log(`App account "${appUser}" can read/insert/update, but cannot delete or change history.`);
  console.log('Next: npm run seed   (loads demo accounts and 5,000+ rows)');
  await admin.end();
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
