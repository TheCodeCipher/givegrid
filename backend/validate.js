// =====================================================================
// validate.js — checks every value that arrives from outside.
// =====================================================================
// Rule: the server trusts NOTHING the browser (or Postman) sends.
// The browser's form checks are only for convenience; anyone can skip
// them and send a request directly. So every route checks again here.
//
// Each function either RETURNS the clean value, or THROWS a 400 error.
// They do not touch the database, so they are easy to unit test.
// =====================================================================

const { HttpError } = require('./errors');

const MAX_QUANTITY = 100000;

function bad(message) {
  return new HttpError(400, message);
}

// Quantities: must be a real number (5, not "5"), whole, between 1 and 100000.
function quantity(value, field) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    throw bad(`${field} must be a whole number from 1 to ${MAX_QUANTITY}`);
  }
  return value;
}

// Required text: must be a string that is not empty after trimming spaces.
function text(value, field, maxLength = 100) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw bad(`${field} is required`);
  }
  if (value.trim().length > maxLength) {
    throw bad(`${field} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

// Optional text: missing or empty becomes null (stored as NULL in MySQL).
function optionalText(value, field, maxLength = 500) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return text(value, field, maxLength);
}

// Must be one of a fixed list, e.g. oneOf(urgency, 'urgency', ['LOW', 'MEDIUM', 'HIGH']).
function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

// Ids, from the URL (always text, e.g. "12") or the body (a number).
function id(value, field = 'id') {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw bad(`${field} must be a positive whole number`);
  }
  return number;
}

function email(value) {
  const clean = text(value, 'email', 255).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {   // something@something.something
    throw bad('email is not a valid email address');
  }
  return clean;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw bad('password must be at least 8 characters');
  }
  return value;
}

module.exports = { quantity, text, optionalText, oneOf, id, email, password };
