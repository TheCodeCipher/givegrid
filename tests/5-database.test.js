// =====================================================================
// 5. DATABASE TESTS  (constraints, append-only history, transactions)
// These test the DATABASE ITSELF, not the JavaScript. Even if our code had
// a bug, MySQL must refuse impossible data, refuse to change history, and
// undo half-finished work.
// =====================================================================

const h = require('./helpers');
const events = require('../backend/services/events');

beforeEach(h.resetDb);
afterAll(h.closeDb);

describe('the schema', () => {
  test('all 7 tables exist', async () => {
    const [rows] = await h.adminDb.query('SHOW TABLES');
    const names = rows.map((r) => Object.values(r)[0]).sort();
    expect(names).toEqual(['allocations', 'categories', 'donation_events', 'donations', 'needs', 'ngos', 'users']);
  });
});

describe('constraints refuse bad data (straight SQL, no API)', () => {
  let donorId;
  beforeEach(async () => {
    donorId = (await h.makeUser('DONOR')).id;
  });

  function insertDonation(total, available) {
    return h.adminDb.query(
      `INSERT INTO donations (donor_id, category_id, title, total_quantity, available_quantity, unit, city)
       VALUES (?, 1, 'Test', ?, ?, 'chairs', 'Delhi')`,
      [donorId, total, available]
    );
  }

  test('CHECK: total quantity must be more than 0', async () => {
    await expect(insertDonation(0, 0)).rejects.toThrow(/constraint/i);
  });

  test('CHECK: available can never be negative or more than the total', async () => {
    await expect(insertDonation(10, -1)).rejects.toThrow(/constraint/i);
    await expect(insertDonation(10, 11)).rejects.toThrow(/constraint/i);
  });

  test('CHECK: a role that is not DONOR/NGO/ADMIN is refused', async () => {
    await expect(h.adminDb.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('X', 'x@test.local', 'h', 'SUPERUSER')"
    )).rejects.toThrow(/constraint/i);
  });

  test('UNIQUE: two accounts with the same email are refused', async () => {
    const add = () => h.adminDb.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ('X', 'same@test.local', 'h', 'DONOR')"
    );
    await add();
    await expect(add()).rejects.toThrow(/Duplicate entry/);
  });

  test('FOREIGN KEY: a donation by a user who does not exist is refused', async () => {
    await expect(h.adminDb.query(
      `INSERT INTO donations (donor_id, category_id, title, total_quantity, available_quantity, unit, city)
       VALUES (99999, 1, 'Test', 10, 10, 'chairs', 'Delhi')`
    )).rejects.toThrow(/foreign key constraint fails/);
  });

  test('NOT NULL: a user without a password hash is refused', async () => {
    await expect(h.adminDb.query(
      "INSERT INTO users (name, email, role) VALUES ('X', 'y@test.local', 'DONOR')"
    )).rejects.toThrow(/doesn't have a default value|cannot be null/);
  });
});

describe('APPEND-ONLY history: nobody can change or delete it', () => {
  // h.pool is logged in as givegrid_app, the SAME limited account the running app uses.
  beforeEach(async () => {
    const donor = await h.makeUser('DONOR');
    await h.makeDonation(donor, 100);              // writes one DONATION_POSTED row
  });

  test('we really are connected as the limited app account', async () => {
    const [rows] = await h.pool.query('SELECT CURRENT_USER() AS who');
    expect(rows[0].who).toBe('givegrid_app@localhost');
  });

  test('the app account cannot UPDATE history', async () => {
    await expect(h.pool.query("UPDATE donation_events SET action = 'CLAIM_HELD' WHERE id = 1"))
      .rejects.toThrow(/command denied/);
  });

  test('the app account cannot DELETE history', async () => {
    await expect(h.pool.query('DELETE FROM donation_events WHERE id = 1')).rejects.toThrow(/command denied/);
  });

  test('the app account cannot TRUNCATE (wipe) history', async () => {
    await expect(h.pool.query('TRUNCATE TABLE donation_events')).rejects.toThrow(/command denied/);
  });

  test('even the ADMIN account is stopped by the trigger', async () => {
    await expect(h.adminDb.query("UPDATE donation_events SET action = 'CLAIM_HELD' WHERE id = 1"))
      .rejects.toThrow('append-only: UPDATE is not allowed');
    await expect(h.adminDb.query('DELETE FROM donation_events WHERE id = 1'))
      .rejects.toThrow('append-only: DELETE is not allowed');
  });

  test('after all those attempts the row is unchanged, and adding new rows still works', async () => {
    expect((await h.row('donation_events', 1)).action).toBe('DONATION_POSTED');
    await h.pool.query("INSERT INTO donation_events (donation_id, seq, action) VALUES (1, 2, 'DONATION_CLOSED')");
    expect(await h.count('donation_events')).toBe(2);
  });

  test('UNIQUE (donation_id, seq): two entries with the same number are refused', async () => {
    await expect(h.pool.query("INSERT INTO donation_events (donation_id, seq, action) VALUES (1, 1, 'DONATION_CLOSED')"))
      .rejects.toThrow(/Duplicate entry/);
  });

  test('least privilege: the app account cannot delete ANY row, anywhere', async () => {
    await expect(h.pool.query('DELETE FROM donations WHERE id = 1')).rejects.toThrow(/command denied/);
    await expect(h.pool.query('DELETE FROM users WHERE id = 1')).rejects.toThrow(/command denied/);
  });
});

describe('TRANSACTIONS: all or nothing', () => {
  test('if a claim fails halfway, every change it made is undone (ROLLBACK)', async () => {
    const donor = await h.makeUser('DONOR');
    const donation = await h.makeDonation(donor, 100);
    const ngo = await h.makeNgoWithNeed(50);
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Make the LAST step of the claim (writing history) fail. By then the
    // claim has already lowered both counters and inserted the claim row.
    const spy = jest.spyOn(events, 'addEvent').mockRejectedValueOnce(new Error('disk full (pretend)'));

    const res = await h.claim(ngo, donation.id, 40);

    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalled();                                          // it really got that far
    expect((await h.row('donations', donation.id)).available_quantity).toBe(100);   // counter undone
    expect((await h.row('needs', ngo.needId)).remaining_quantity).toBe(50);         // counter undone
    expect(await h.count('allocations')).toBe(0);                                   // claim undone
    expect(await h.count('donation_events')).toBe(1);                               // only DONATION_POSTED
    spy.mockRestore();
    quiet.mockRestore();
    await h.checkInvariants();
  });

  test('posting a donation saves the donation and its history together', async () => {
    const donor = await h.makeUser('DONOR');
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    const spy = jest.spyOn(events, 'addEvent').mockRejectedValueOnce(new Error('pretend failure'));

    const res = await h.post('/api/donations', donor, { category_id: 1, title: 'X', total_quantity: 5, unit: 'x', city: 'Delhi' });

    expect(res.status).toBe(500);
    expect(await h.count('donations')).toBe(0);           // no donation without its history
    spy.mockRestore();
    quiet.mockRestore();
  });
});
