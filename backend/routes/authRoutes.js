// =====================================================================
// routes/authRoutes.js — mounted at /api/auth  (see app.js)
// =====================================================================
//   POST /api/auth/register   create an account, get a token
//   POST /api/auth/login      log in, get a token
//   GET  /api/auth/me         who am I? (needs a token)
// =====================================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { HttpError, asyncHandler } = require('../errors');
const { makeToken, authenticate } = require('../auth');
const validate = require('../validate');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
  // Take ONLY the fields we expect (never the whole body: "mass assignment").
  const name = validate.text(req.body.name, 'name');
  const email = validate.email(req.body.email);
  const password = validate.password(req.body.password);
  // Nobody can make themselves ADMIN through the API.
  const role = validate.oneOf(req.body.role, 'role', ['DONOR', 'NGO']);

  // bcrypt: one-way hash with a random salt. 10 = cost factor (how slow it is on purpose).
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, role]
    );
    const user = { id: result.insertId, name, email, role };
    res.status(201).json({ token: makeToken(user), user });
  } catch (err) {
    // The UNIQUE rule on email is what really stops duplicates.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'An account with this email already exists');
    }
    throw err;
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const email = validate.email(req.body.email);
  if (typeof req.body.password !== 'string') {
    throw new HttpError(400, 'password is required');
  }

  const [rows] = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = ?',
    [email]
  );
  const found = rows[0];

  // SAME message for "no such email" and "wrong password", so an attacker
  // cannot find out which emails have accounts (user enumeration).
  if (!found || !(await bcrypt.compare(req.body.password, found.password_hash))) {
    throw new HttpError(401, 'Wrong email or password');
  }

  // Build the reply WITHOUT password_hash.
  const user = { id: found.id, name: found.name, email: found.email, role: found.role };
  res.json({ token: makeToken(user), user });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, email, role FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) {
    throw new HttpError(404, 'Account not found');
  }
  res.json(rows[0]);
}));

module.exports = router;
