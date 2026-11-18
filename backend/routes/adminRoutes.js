// =====================================================================
// routes/adminRoutes.js — mounted at /api/admin
// =====================================================================
//   GET   /api/admin/ngos?status=PENDING           list NGOs (filter optional)
//   PATCH /api/admin/ngos/:id/verification         body { status: VERIFIED | REJECTED }
// =====================================================================

const express = require('express');
const { pool } = require('../db');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, authorise } = require('../auth');
const validate = require('../validate');

const router = express.Router();

router.use(authenticate, authorise('ADMIN'));      // admins only, for the whole file

router.get('/ngos', asyncHandler(async (req, res) => {
  // No ?status= means "all". "? IS NULL OR ..." makes the filter optional.
  const status = req.query.status ? validate.oneOf(req.query.status, 'status', ['PENDING', 'VERIFIED', 'REJECTED']) : null;
  const [rows] = await pool.query(
    `SELECT g.id, g.name, g.city, g.locality, g.status, g.created_at, u.email
       FROM ngos g JOIN users u ON u.id = g.user_id
      WHERE ? IS NULL OR g.status = ?
      ORDER BY g.id DESC`,
    [status, status]
  );
  res.json(rows);
}));

// PATCH = change part of a row (only the status), not replace all of it (PUT).
router.patch('/ngos/:id/verification', asyncHandler(async (req, res) => {
  const ngoId = validate.id(req.params.id);
  const status = validate.oneOf(req.body.status, 'status', ['VERIFIED', 'REJECTED']);

  const [result] = await pool.query('UPDATE ngos SET status = ? WHERE id = ?', [status, ngoId]);
  if (result.affectedRows === 0) {                  // affectedRows 0 = no row had that id
    throw new HttpError(404, 'NGO not found');
  }
  const [rows] = await pool.query('SELECT * FROM ngos WHERE id = ?', [ngoId]);
  res.json(rows[0]);
}));

module.exports = router;
