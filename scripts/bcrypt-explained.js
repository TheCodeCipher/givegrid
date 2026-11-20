// =====================================================================
// scripts/bcrypt-explained.js — what a bcrypt hash is made of, and how
// login checks a password without ever storing it.
//
// Run it:  node scripts/bcrypt-explained.js            (uses "password123")
//          node scripts/bcrypt-explained.js MyPass99   (your own password)
// =====================================================================

const bcrypt = require('bcryptjs');

async function main() {
  const password = process.argv[2] || 'password123';
  const COST = 10;                                    // the same cost our register route uses

  // ---- 1. Hash the same password twice ----
  const hashA = await bcrypt.hash(password, COST);
  const hashB = await bcrypt.hash(password, COST);
  console.log('Password            :', password);
  console.log('Hash, first time    :', hashA);
  console.log('Hash, second time   :', hashB);
  console.log('Same?               :', hashA === hashB, ' <- different, because each gets a new random SALT');
  console.log();

  // ---- 2. Take a hash apart (always 60 characters) ----
  console.log('Anatomy of', hashA);
  console.log('  ', hashA.slice(0, 4), '        -> version of bcrypt ($2b$)');
  console.log('  ', hashA.slice(4, 6), '          -> cost factor: 2^' + hashA.slice(4, 6), '=', 2 ** Number(hashA.slice(4, 6)), 'rounds of key setup');
  console.log('  ', hashA.slice(7, 29), ' -> salt: 16 random bytes, written as 22 characters');
  console.log('  ', hashA.slice(29), ' -> the result: 23 bytes, written as 31 characters');
  console.log();

  // ---- 3. How login works: hash the typed password WITH THE STORED SALT, compare ----
  const storedSaltAndCost = hashA.slice(0, 29);       // "$2b$10$" + the 22-character salt
  const again = await bcrypt.hash(password, storedSaltAndCost);
  console.log('Re-hash with the stored salt gives the same hash?', again === hashA);
  console.log('That is all bcrypt.compare() does:');
  console.log('  compare(correct password) =', await bcrypt.compare(password, hashA));
  console.log('  compare("wrong-password") =', await bcrypt.compare('wrong-password', hashA));
  console.log();

  // ---- 4. Why the cost factor matters: each +1 doubles the time ----
  for (const cost of [4, 8, 10, 12]) {
    const start = Date.now();
    await bcrypt.hash(password, cost);
    console.log(`cost ${String(cost).padStart(2)} -> ${String(Date.now() - start).padStart(4)} ms per guess`);
  }
  console.log('Slow on purpose: fine for one login, painful for someone trying millions of guesses.');
}

main();
