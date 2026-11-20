// =====================================================================
// security.js — two extra layers of protection, written by hand
// (no library), so every line can be explained.
//
//   securityHeaders  -> tells the browser to be strict with our pages
//   login limiter    -> stops someone guessing passwords over and over
// =====================================================================

// ---------------------------------------------------------------------
// LAYER: security headers. Added to EVERY reply (used in app.js).
// A header is a small "label" on the reply that the browser reads.
// ---------------------------------------------------------------------
function securityHeaders(req, res, next) {
  // Don't guess a file's type. Stops a text file being run as a script.
  res.set('X-Content-Type-Options', 'nosniff');
  // No other website may show our pages inside a frame (stops "clickjacking":
  // hiding our real buttons under a fake page so the user clicks them unknowingly).
  res.set('X-Frame-Options', 'DENY');
  // Don't tell other sites which of our pages a user came from.
  res.set('Referrer-Policy', 'no-referrer');
  // Content Security Policy (CSP): load scripts, styles and data ONLY from our own
  // server ('self'). If an attacker managed to inject <script src="https://evil.com/x.js">,
  // the browser would refuse to load it.
  // script-src-attr 'unsafe-inline' is needed because our buttons use onclick="..." attributes.
  res.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; script-src-attr 'unsafe-inline'; frame-ancestors 'none'");
  next();
}

// ---------------------------------------------------------------------
// LAYER: login limiter (protection against "brute force" password guessing).
// After 5 WRONG passwords for the same email from the same computer (IP
// address), that pair is blocked for 15 minutes: replies 429 Too Many Requests.
// A correct login clears the count.
//
// The counts live in memory (a Map). Honest limits: they reset when the
// server restarts, and with several servers each would count separately.
// That's fine for this project; a bigger site would store them in a database.
// ---------------------------------------------------------------------
const MAX_FAILED_LOGINS = 5;
const WINDOW_MS = 15 * 60 * 1000;      // 15 minutes in milliseconds

// key "ip|email"  ->  { count: number of wrong passwords, firstAt: time of the first one }
const failedLogins = new Map();

function isBlocked(key) {
  const entry = failedLogins.get(key);
  if (!entry) {
    return false;                                 // no failures recorded
  }
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failedLogins.delete(key);                     // 15 minutes passed: forget them
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

function recordFailure(key) {
  const entry = failedLogins.get(key);
  if (entry) {
    entry.count = entry.count + 1;
  } else {
    failedLogins.set(key, { count: 1, firstAt: Date.now() });
  }
}

function clearFailures(key) {
  failedLogins.delete(key);
}

module.exports = { securityHeaders, isBlocked, recordFailure, clearFailures, MAX_FAILED_LOGINS };
