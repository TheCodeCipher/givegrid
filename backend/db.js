// =====================================================================
// db.js — the connection to MySQL that the whole backend shares.
// =====================================================================
// Exports two things:
//   pool              -> for normal one-off queries:  pool.query(sql, values)
//   withTransaction() -> for work where several changes must ALL happen
//                        or NONE happen (the claim, cancel, expiry...)
// =====================================================================

const mysql = require('mysql2/promise');   // the "/promise" version lets us use await
const config = require('./config');

// A POOL keeps up to 10 open connections and lends one to each request.
// Opening a new MySQL connection for every request would be slow.
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.appUser,          // the LIMITED account (see scripts/setup.js)
  password: config.db.appPassword,
  database: config.isTest ? config.db.testName : config.db.name,
  connectionLimit: 10,
  ssl: config.db.ssl,               // encrypted in the cloud, plain on the laptop
});

// ---------------------------------------------------------------------
// withTransaction(work)
//
// A transaction = a group of SQL changes treated as ONE change.
//   BEGIN    -> start the group
//   COMMIT   -> save all of them
//   ROLLBACK -> undo all of them
//
// "work" is a function we pass in. It receives "conn" and must run all
// its queries on conn (not on pool), so they are all in the same group.
// If work finishes: COMMIT. If work throws an error anywhere: ROLLBACK.
// ---------------------------------------------------------------------
async function withTransaction(work) {
  const conn = await pool.getConnection();       // borrow ONE connection from the pool
  try {
    // READ COMMITTED: every normal SELECT sees the newest saved data.
    // (MySQL's default, REPEATABLE READ, can show an older snapshot.)
    // The real protection is still the row locks (FOR UPDATE) we take.
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();                // BEGIN
    const result = await work(conn);              // run all the queries
    await conn.commit();                          // COMMIT: save everything
    return result;
  } catch (err) {
    await conn.rollback();                        // ROLLBACK: undo everything
    throw err;                                    // pass the error on (to the error handler)
  } finally {
    conn.release();                               // always give the connection back
  }
}

module.exports = { pool, withTransaction };
