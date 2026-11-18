// =====================================================================
// routes/donationRoutes.js — mounted at /api/donations
// =====================================================================
//   POST  /api/donations                    donor lists a donation
//   GET   /api/donations                    open donations (?mine=true = my own)
//   GET   /api/donations/:id                one donation
//   PATCH /api/donations/:id                owner edits title / description
//   POST  /api/donations/:id/close          owner stops new claims
//   GET   /api/donations/:id/events         the donation's history (timeline)
//   GET   /api/donations/:id/matching-needs needs ranked for this donation
//   POST  /api/donations/:id/claims         NGO claims some of it   <- the hard part
// =====================================================================

const express = require('express');
const { pool, withTransaction } = require('../db');
const { HttpError, asyncHandler } = require('../errors');
const { authenticate, authorise } = require('../auth');
const validate = require('../validate');
const events = require('../services/events');
const claims = require('../services/claims');
const matching = require('../services/matching');

const router = express.Router();

router.use(authenticate);              // every donation route needs a login

// Small helper used by several routes: get one donation or reply 404.
async function findDonation(id) {
  const [rows] = await pool.query(
    `SELECT d.*, c.name AS category_name, u.name AS donor_name
       FROM donations d
       JOIN categories c ON c.id = d.category_id
       JOIN users u      ON u.id = d.donor_id
      WHERE d.id = ?`,
    [id]
  );
  if (!rows[0]) {
    throw new HttpError(404, 'Donation not found');
  }
  return rows[0];
}

// The donation AND its first history entry are saved in ONE transaction.
router.post('/', authorise('DONOR'), asyncHandler(async (req, res) => {
  const d = {
    categoryId: validate.id(req.body.category_id, 'category_id'),
    title: validate.text(req.body.title, 'title', 150),
    description: validate.optionalText(req.body.description, 'description'),
    total: validate.quantity(req.body.total_quantity, 'total_quantity'),
    unit: validate.text(req.body.unit, 'unit', 30).toLowerCase(),   // "Chairs" -> "chairs"
    city: validate.text(req.body.city, 'city'),
    locality: validate.optionalText(req.body.locality, 'locality', 100),
  };

  try {
    const newId = await withTransaction(async (conn) => {
      // available_quantity starts equal to total_quantity (the 5th ? is used twice).
      const [result] = await conn.query(
        `INSERT INTO donations (donor_id, category_id, title, description, total_quantity,
                                available_quantity, unit, city, locality)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, d.categoryId, d.title, d.description, d.total, d.total, d.unit, d.city, d.locality]
      );
      // No lock needed: nobody else can see this new row until we COMMIT.
      await events.addEvent(conn, {
        donationId: result.insertId, action: 'DONATION_POSTED', quantity: d.total, actorId: req.user.id,
      });
      return result.insertId;
    });
    // 201 Created + Location header = where the new resource lives.
    res.status(201).location(`/api/donations/${newId}`).json(await findDonation(newId));
  } catch (err) {
    // The foreign key on category_id rejected an id that does not exist.
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new HttpError(400, 'category_id does not exist');
    }
    throw err;
  }
}));

// GET /api/donations             -> everyone's OPEN donations, newest first
// GET /api/donations?mine=true   -> all of MY donations (open and closed)
// Optional paging: ?limit=20&offset=40  (page 3 of 20 per page)
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(validate.id(req.query.limit || 20, 'limit'), 100);
  const offset = Number(req.query.offset || 0);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new HttpError(400, 'offset must be 0 or more');
  }

  let rows;
  if (req.query.mine === 'true') {
    [rows] = await pool.query(
      `SELECT d.*, c.name AS category_name
         FROM donations d JOIN categories c ON c.id = d.category_id
        WHERE d.donor_id = ?
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );
  } else {
    [rows] = await pool.query(
      `SELECT d.*, c.name AS category_name
         FROM donations d JOIN categories c ON c.id = d.category_id
        WHERE d.status = 'OPEN'
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json(await findDonation(validate.id(req.params.id)));
}));

// Only text can be edited. Quantity, category and unit cannot, because
// claims and history already depend on them.
router.patch('/:id', authorise('DONOR'), asyncHandler(async (req, res) => {
  const id = validate.id(req.params.id);
  const title = validate.text(req.body.title, 'title', 150);
  const description = validate.optionalText(req.body.description, 'description');

  const donation = await findDonation(id);                       // 404 if it does not exist
  if (donation.donor_id !== req.user.id) {
    throw new HttpError(403, 'You can only edit your own donations');
  }
  await pool.query('UPDATE donations SET title = ?, description = ? WHERE id = ?', [title, description, id]);
  res.json(await findDonation(id));
}));

router.post('/:id/close', authorise('DONOR'), asyncHandler(async (req, res) => {
  const id = validate.id(req.params.id);
  await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM donations WHERE id = ? FOR UPDATE', [id]);
    const donation = rows[0];
    if (!donation) {
      throw new HttpError(404, 'Donation not found');
    }
    if (donation.donor_id !== req.user.id) {
      throw new HttpError(403, 'You can only close your own donations');
    }
    if (donation.status === 'CLOSED') {
      throw new HttpError(409, 'This donation is already closed');
    }
    await conn.query("UPDATE donations SET status = 'CLOSED' WHERE id = ?", [id]);
    await events.addEvent(conn, { donationId: id, action: 'DONATION_CLOSED', actorId: req.user.id });
  });
  res.json(await findDonation(id));
}));

// LEFT JOIN: keep events with no actor (the expiry timer), showing NULL as the name.
router.get('/:id/events', asyncHandler(async (req, res) => {
  const id = validate.id(req.params.id);
  await findDonation(id);
  const [rows] = await pool.query(
    `SELECT e.seq, e.action, e.quantity, e.allocation_id, e.created_at, u.name AS actor_name
       FROM donation_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.donation_id = ?
      ORDER BY e.seq`,
    [id]
  );
  res.json(rows);
}));

router.get('/:id/matching-needs', asyncHandler(async (req, res) => {
  const id = validate.id(req.params.id);
  await findDonation(id);
  res.json(await matching.needsForDonation(id));
}));

// THE CLAIM. All the careful work is in services/claims.js.
// 201 = reserved.   409 + "offer" = counter-proposal, nothing reserved.
router.post('/:id/claims', authorise('NGO'), asyncHandler(async (req, res) => {
  const donationId = validate.id(req.params.id);
  const needId = validate.id(req.body.need_id, 'need_id');
  const quantity = validate.quantity(req.body.quantity, 'quantity');

  const claim = await claims.createClaim(req.user, donationId, needId, quantity);
  res.status(201).location(`/api/claims/${claim.id}`).json(claim);
}));

module.exports = router;
