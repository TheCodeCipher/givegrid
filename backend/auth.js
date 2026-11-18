// =====================================================================
// auth.js — login tokens (JWT) and the two "bouncer" middlewares.
// =====================================================================
//   makeToken(user)       -> creates a signed token after login/register
//   authenticate          -> WHO are you?  (no valid token  = 401)
//   authorise('ADMIN',..) -> are you ALLOWED? (wrong role   = 403)
// =====================================================================

const jwt = require('jsonwebtoken');
const config = require('./config');
const { HttpError } = require('./errors');

// The token holds the user's id and role, SIGNED with our secret.
// Anyone can read a JWT, but nobody can change it without the secret,
// because the signature would no longer match. So the role cannot be faked.
function makeToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '1d' });
}

// Middleware: reads the header  "Authorization: Bearer <token>".
// If the token is valid, puts { id, role } into req.user for the next step.
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Please log in'));
  }
  const token = header.slice(7);                    // remove "Bearer " (7 characters)
  try {
    const payload = jwt.verify(token, config.jwtSecret);   // checks signature AND expiry
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch (err) {
    next(new HttpError(401, 'Your login is invalid or has expired. Please log in again'));
  }
}

// Middleware FACTORY: authorise('NGO') returns a middleware that only lets
// NGO accounts through. Always used AFTER authenticate (it needs req.user).
function authorise(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return next(new HttpError(403, 'Your account type is not allowed to do this'));
    }
    next();
  };
}

module.exports = { makeToken, authenticate, authorise };
