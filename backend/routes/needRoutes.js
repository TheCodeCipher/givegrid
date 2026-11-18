// =====================================================================
// routes/needRoutes.js — mounted at /api/needs
// =====================================================================
//   POST /api/needs              verified NGO posts a need
//   GET  /api/needs              the needs board: open needs, most urgent first
//                                (?mine=true = my NGO's needs)
//   GET  /api/needs/:id          one need
//   GET  /api/needs/:id/matches  donations ranked for this need
// =====================================================================

const express = require('express');
const { pool } = require('../db');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, authorise } = require('../auth');
const validate = require('../validate');
const matching = require('../services/matching');

const router = express.Router();

router.use(authenticate);

async function findNeed(id) {
  const [rows] = await pool.query(
    `SELECT n.*, c.name AS category_name, g.name AS ngo_name
       FROM needs n
       JOIN categories c ON c.id = n.category_id
       JOIN ngos g       ON g.id = n.ngo_id
      WHERE n.id = ?`,
    [id]
  );
  if (!rows[0]) {
    throw new HttpError(404, 'Need not found');
  }
  return rows[0];
}

router.post('/', authorise('NGO'), asyncHandler(async (req, res) => {
  const [ngoRows] = await pool.query('SELECT id, status FROM ngos WHERE user_id = ?', [req.user.id]);
  const ngo = ngoRows[0];
  if (!ngo) {
    throw new HttpError(403, 'Register your NGO first');
  }
  if (ngo.status !== 'VERIFIED') {
    throw new HttpError(403, 'Only verified NGOs can post needs');
  }

  const categoryId = validate.id(req.body.category_id, 'category_id');
  const title = validate.text(req.body.title, 'title', 150);
  const required = validate.quantity(req.body.quantity_required, 'quantity_required');
  const unit = validate.text(req.body.unit, 'unit', 30).toLowerCase();
  const urgency = validate.oneOf(req.body.urgency, 'urgency', ['LOW', 'MEDIUM', 'HIGH']);
  const city = validate.text(req.body.city, 'city');
  const locality = validate.optionalText(req.body.locality, 'locality', 100);

  try {
    // remaining_quantity starts equal to quantity_required.
    const [result] = await pool.query(
      `INSERT INTO needs (ngo_id, category_id, title, quantity_required, remaining_quantity,
                          unit, urgency, city, locality)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ngo.id, categoryId, title, required, required, unit, urgency, city, locality]
    );
    res.status(201).location(`/api/needs/${result.insertId}`).json(await findNeed(result.insertId));
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new HttpError(400, 'category_id does not exist');
    }
    throw err;
  }
}));

// GET /api/needs            -> the needs board: open needs, most urgent first
// GET /api/needs?mine=true  -> all of MY NGO's needs
// FIELD(urgency, 'HIGH', 'MEDIUM', 'LOW') gives HIGH=1, MEDIUM=2, LOW=3, so HIGH sorts first.
router.get('/', asyncHandler(async (req, res) => {
  let rows;
  if (req.query.mine === 'true') {
    [rows] = await pool.query(
      `SELECT n.*, c.name AS category_name, g.name AS ngo_name
         FROM needs n
         JOIN categories c ON c.id = n.category_id
         JOIN ngos g       ON g.id = n.ngo_id
        WHERE g.user_id = ?
        ORDER BY n.id DESC`,
      [req.user.id]
    );
  } else {
    [rows] = await pool.query(
      `SELECT n.*, c.name AS category_name, g.name AS ngo_name
         FROM needs n
         JOIN categories c ON c.id = n.category_id
         JOIN ngos g       ON g.id = n.ngo_id
        WHERE n.status = 'OPEN' AND n.remaining_quantity > 0
        ORDER BY FIELD(n.urgency, 'HIGH', 'MEDIUM', 'LOW'), n.id DESC
        LIMIT 50`
    );
  }
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await findNeed(validate.id(req.params.id)));
}));

router.get('/:id/matches', asyncHandler(async (req, res) => {
  const id = validate.id(req.params.id);
  await findNeed(id);
  res.json(await matching.donationsForNeed(id));
}));

module.exports = router;
