// =====================================================================
// app.js — builds the Express app. Does NOT start listening.
// =====================================================================
// Why split from server.js: the tests (Supertest) import this app and
// send requests to it directly, without starting a real server.
//
// A request passes through these in ORDER (top to bottom):
//   1. securityHeaders  adds safety headers to every reply
//   2. express.json()   turns the JSON body into req.body (max 10 kB)
//   3. express.static   serves the frontend files (HTML/CSS/JS)
//   4. the API routes   /api/...
//   5. 404 handler      no route matched
//   6. error handler    anything that went wrong (4 arguments = error handler)
// =====================================================================

const path = require('path');
const express = require('express');
const { pool } = require('./db');
const { HttpError, asyncHandler } = require('./errors');
const { securityHeaders } = require('./security');

const app = express();

// Railway (and any host) puts a proxy in front of us. Trust ONE hop,
// so req.ip is the visitor's real IP (from X-Forwarded-For), not the proxy's.
app.set('trust proxy', 1);

// Don't advertise "X-Powered-By: Express" (tells attackers what to target).
app.disable('x-powered-by');

// Security headers on every reply (see security.js).
app.use(securityHeaders);

// Bodies larger than 10 kB are refused (413). Stops someone sending a huge body to tie up the server.
app.use(express.json({ limit: '10kb' }));

// The frontend is served by this same server, so the browser and the API
// share one origin (http://localhost:3000). That is why we need no CORS setup.
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health checks: "is the server up?" and "can it reach MySQL?"
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'GiveGrid API is running' });
});
app.get('/api/health/db', asyncHandler(async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ error: 'Cannot connect to the database' });
  }
}));

// Categories for the dropdown menus. Public, read only.
app.get('/api/categories', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM categories ORDER BY name');
  res.json(rows);
}));

// Each router file handles everything under its path.
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/ngos', require('./routes/ngoRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/donations', require('./routes/donationRoutes'));
app.use('/api/needs', require('./routes/needRoutes'));
app.use('/api/claims', require('./routes/claimRoutes'));

// Reached only if no route above answered.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ERROR HANDLER. Express knows it is one because it has 4 arguments (err first).
// Every next(err) and every error caught by asyncHandler ends up here.
app.use((err, req, res, next) => {
  // Errors we threw on purpose: send their status and message.
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  // express.json() could not read the body.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  // The body was bigger than the 10 kB limit.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  // Anything else is a real bug. Log it for us, but NEVER send SQL or a
  // stack trace to the client (it would help an attacker).
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

module.exports = app;
