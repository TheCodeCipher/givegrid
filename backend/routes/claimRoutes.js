// =====================================================================
// routes/claimRoutes.js — mounted at /api/claims
// =====================================================================
//   GET  /api/claims               the claims I am part of
//   POST /api/claims/:id/confirm   NGO confirms pickup plan (within 48 h)
//   POST /api/claims/:id/cancel    NGO cancels before pickup (items go back)
//   POST /api/claims/:id/pickup    DONOR records the items were handed over
//   POST /api/claims/:id/deliver   NGO records the items arrived
//   POST /api/claims/:id/receipt   NGO confirms final receipt
// (A claim is CREATED at POST /api/donations/:id/claims.)
// =====================================================================

const express = require('express');
const { asyncHandler } = require('../errors');
const { authenticate, authorise } = require('../auth');
const validate = require('../validate');
const claims = require('../services/claims');

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  res.json(await claims.listClaims(req.user));
}));

// One small function builds the handler for each step, so the five
// routes below are identical except for the step name.
function stepHandler(stepName) {
  return asyncHandler(async (req, res) => {
    const claim = await claims.changeClaim(req.user, validate.id(req.params.id), stepName);
    res.json(claim);
  });
}

router.post('/:id/confirm', authorise('NGO'), stepHandler('confirm'));
router.post('/:id/cancel', authorise('NGO'), stepHandler('cancel'));
router.post('/:id/pickup', authorise('DONOR'), stepHandler('pickup'));
router.post('/:id/deliver', authorise('NGO'), stepHandler('deliver'));
router.post('/:id/receipt', authorise('NGO'), stepHandler('receipt'));

module.exports = router;
