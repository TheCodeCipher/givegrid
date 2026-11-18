// =====================================================================
// server.js — starts GiveGrid.   npm start   (or  npm run dev)
// =====================================================================
// 1. Starts listening on the port from .env.
// 2. Starts the EXPIRY TIMER: once a minute it releases claims whose
//    48-hour hold ran out without being confirmed.
// =====================================================================

const config = require('./config');
const app = require('./app');
const { pool } = require('./db');
const claims = require('./services/claims');

const ONE_MINUTE = 60 * 1000;   // setInterval works in milliseconds

async function runExpiry() {
  try {
    const count = await claims.expireOldHolds();
    if (count > 0) {
      console.log(`Expiry timer: released ${count} expired hold(s)`);
    }
  } catch (err) {
    console.error('Expiry timer failed:', err.message);
  }
}

app.listen(config.port, async () => {
  console.log(`GiveGrid running at http://localhost:${config.port}`);
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Database NOT connected:', err.message);
  }
  runExpiry();                          // once now...
  setInterval(runExpiry, ONE_MINUTE);   // ...and then every minute
});
