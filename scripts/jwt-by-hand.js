// =====================================================================
// scripts/jwt-by-hand.js — build a login token (JWT) step by step,
// WITHOUT the jsonwebtoken library, then prove the library agrees.
//
// Run it:  node scripts/jwt-by-hand.js
// (In WebStorm: right-click this file -> Run.)
//
// A JWT is three parts joined by dots:   HEADER . PAYLOAD . SIGNATURE
// =====================================================================

const crypto = require('crypto');          // built into Node.js, nothing to install
const jwt = require('jsonwebtoken');       // only used at the end, to CHECK our work
const config = require('../backend/config');

// base64url = normal base64, then:  remove "=" padding,  "+" -> "-",  "/" -> "_"
// (so the token is safe to put in a URL or a header)
function base64url(text) {
  return Buffer.from(text).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// ---- Step 1: the header says which algorithm signs the token ----
const header = { alg: 'HS256', typ: 'JWT' };
const headerJson = JSON.stringify(header);
const headerPart = base64url(headerJson);

// ---- Step 2: the payload = the data. Same fields our makeToken() uses. ----
const now = Math.floor(Date.now() / 1000);                  // JWT times are in SECONDS
const payload = { id: 2, role: 'DONOR', iat: now, exp: now + 24 * 60 * 60 };   // valid for 1 day
const payloadJson = JSON.stringify(payload);
const payloadPart = base64url(payloadJson);

// ---- Step 3: sign "header.payload" with HMAC-SHA256 and our secret ----
const signingInput = headerPart + '.' + payloadPart;
const signaturePart = crypto.createHmac('sha256', config.jwtSecret).update(signingInput).digest('base64url');

// ---- Step 4: join the three parts ----
const token = signingInput + '.' + signaturePart;

console.log('1. header JSON      :', headerJson);
console.log('   base64url        :', headerPart);
console.log('2. payload JSON     :', payloadJson);
console.log('   base64url        :', payloadPart);
console.log('3. HMAC-SHA256 of "header.payload" with JWT_SECRET from .env');
console.log('   signature        :', signaturePart);
console.log('4. TOKEN            :', token);
console.log();

// ---- Proof 1: the library makes the IDENTICAL token from the same data ----
const libraryToken = jwt.sign({ id: 2, role: 'DONOR', iat: now }, config.jwtSecret, { expiresIn: '1d' });
console.log('Same as jsonwebtoken.sign()?           ', libraryToken === token);

// ---- Proof 2: the library accepts our hand-made token ----
console.log('jsonwebtoken.verify() accepts it, gives:', jwt.verify(token, config.jwtSecret));

// ---- Proof 3: anyone can READ a JWT (it is signed, not encrypted) ----
console.log('Anyone can decode the payload:          ', Buffer.from(payloadPart, 'base64url').toString());

// ---- Proof 4: change the role to ADMIN but keep the old signature -> rejected ----
const fakePayloadPart = base64url(JSON.stringify({ ...payload, role: 'ADMIN' }));
const forged = headerPart + '.' + fakePayloadPart + '.' + signaturePart;
try {
  jwt.verify(forged, config.jwtSecret);
  console.log('Forged token accepted?!');
} catch (err) {
  console.log('Forged ADMIN token rejected because:    ', err.message);
}
console.log();
console.log('Tip: paste the TOKEN above into Postman (Authorization -> Bearer) while npm start is running:');
console.log('     GET http://localhost:3000/api/auth/me  answers as user 2 (donor@givegrid.local after npm run seed).');
