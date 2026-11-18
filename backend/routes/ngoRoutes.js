// =====================================================================
// routes/ngoRoutes.js — mounted at /api/ngos
// =====================================================================
//   POST /api/ngos       NGO account creates its NGO profile (starts PENDING)
//   GET  /api/ngos/me    NGO account reads its own profile and status
// =====================================================================

const express = require('express');
const { pool } = require('../db');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, authorise } = require('../auth');
const validate = require('../validate');

const router = express.Router();

// Every route in this file needs: logged in (authenticate) AND an NGO account (authorise).
router.use(authenticate, authorise('NGO'));

router.post('/', asyncHandler(async (req, res) => {
  const name = validate.text(req.body.name, 'name', 150);
  const city = validate.text(req.body.city, 'city');
  const locality = validate.optionalText(req.body.locality, 'locality', 100);

  try {
    // status is not sent: the database default makes it PENDING.
    const [result] = await pool.query(
      'INSERT INTO ngos (user_id, name, city, locality) VALUES (?, ?, ?, ?)',
      [req.user.id, name, city, locality]
    );
    const [rows] = await pool.query('SELECT * FROM ngos WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    // ngos.user_id is UNIQUE: a second profile for the same account fails.
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'Your account already has an NGO profile');
    }
    throw err;
  }
}));

router.get('/me', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM ngos WHERE user_id = ?', [req.user.id]);
  if (!rows[0]) {
    throw new HttpError(404, 'You have not registered your NGO yet');
  }
  res.json(rows[0]);
}));

module.exports = router;
