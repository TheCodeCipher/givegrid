// =====================================================================
// config.js — reads the .env file ONCE and hands the values to everyone.
// =====================================================================
// Why: passwords and secrets must not be written in the code (they would
// end up on GitHub). They live in .env, which Git ignores.
// If something important is missing we stop immediately with a clear
// message, instead of failing later with a confusing error.
// =====================================================================

const path = require('path');

// Load .env from the project folder into process.env.
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const required = ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_TEST_NAME', 'DB_APP_USER', 'DB_APP_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} in .env  (copy .env.example to .env and fill it in)`);
  }
}

module.exports = {
  // Jest sets NODE_ENV to "test" by itself, so tests use the test database.
  isTest: process.env.NODE_ENV === 'test',
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME,
    testName: process.env.DB_TEST_NAME,
    appUser: process.env.DB_APP_USER,
    appPassword: process.env.DB_APP_PASSWORD,
    adminUser: process.env.DB_ADMIN_USER,
    adminPassword: process.env.DB_ADMIN_PASSWORD,
    // DB_SSL=true in the cloud: Azure only accepts encrypted (TLS) connections.
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
    // Where givegrid_app may log in FROM. Laptop: 'localhost'. Cloud: '%' (any address).
    appHost: process.env.DB_APP_HOST || 'localhost',
  },
};
