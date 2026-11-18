// =====================================================================
// services/matching.js — ranked matching, done with one SQL query each.
// =====================================================================
// No AI. Every point can be explained:
//
//   Category fit : only the SAME category and unit are listed at all
//   Quantity fit : +30 if the donation covers everything the need still needs
//   Locality     : +20 same city AND same area,  +10 same city only
//   Urgency      : +30 HIGH, +15 MEDIUM, +0 LOW   (only when ranking needs)
//
// Ties are broken by quantity, then id, so the order is always the same.
// (MySQL compares text ignoring upper/lower case, so "delhi" = "Delhi".)
// =====================================================================

const { pool } = require('../db');

// For an NGO: the best open donations for one of its needs.
async function donationsForNeed(needId) {
  const [rows] = await pool.query(
    `SELECT d.id, d.title, d.available_quantity, d.unit, d.city, d.locality,
            (d.available_quantity >= n.remaining_quantity) AS covers_need,
            (CASE WHEN d.available_quantity >= n.remaining_quantity THEN 30 ELSE 0 END)
          + (CASE WHEN d.city = n.city AND d.locality = n.locality THEN 20
                  WHEN d.city = n.city THEN 10
                  ELSE 0 END) AS score
       FROM needs n
       JOIN donations d ON d.category_id = n.category_id AND d.unit = n.unit
      WHERE n.id = ?
        AND d.status = 'OPEN'
        AND d.available_quantity > 0
      ORDER BY score DESC, d.available_quantity DESC, d.id
      LIMIT 50`,
    [needId]
  );
  return rows;
}

// For a donor: which verified NGOs' needs this donation should go to first.
async function needsForDonation(donationId) {
  const [rows] = await pool.query(
    `SELECT n.id, n.title, n.remaining_quantity, n.unit, n.urgency, n.city, n.locality,
            g.name AS ngo_name,
            (CASE n.urgency WHEN 'HIGH' THEN 30 WHEN 'MEDIUM' THEN 15 ELSE 0 END)
          + (CASE WHEN d.available_quantity >= n.remaining_quantity THEN 30 ELSE 0 END)
          + (CASE WHEN d.city = n.city AND d.locality = n.locality THEN 20
                  WHEN d.city = n.city THEN 10
                  ELSE 0 END) AS score
       FROM donations d
       JOIN needs n ON n.category_id = d.category_id AND n.unit = d.unit
       JOIN ngos g  ON g.id = n.ngo_id
      WHERE d.id = ?
        AND n.status = 'OPEN'
        AND n.remaining_quantity > 0
        AND g.status = 'VERIFIED'
      ORDER BY score DESC, n.remaining_quantity DESC, n.id
      LIMIT 50`,
    [donationId]
  );
  return rows;
}

module.exports = { donationsForNeed, needsForDonation };
