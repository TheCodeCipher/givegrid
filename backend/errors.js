// =====================================================================
// errors.js — how the backend reports problems.
// =====================================================================

// HttpError: an error WE throw on purpose, carrying the HTTP status code.
//   throw new HttpError(404, 'Donation not found');
// "extra" adds more fields to the reply, e.g. { offer: 30 } for a counter-proposal.
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// asyncHandler: the fix for the "Express 4 async trap".
// Express 4 does NOT notice errors thrown inside an async function: the
// request would just hang. This wrapper catches them (.catch) and passes
// them to next(err), which sends them to our error handler in app.js.
function asyncHandler(fn) {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

module.exports = { HttpError, asyncHandler };
