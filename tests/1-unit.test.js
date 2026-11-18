// =====================================================================
// 1. UNIT TESTS
// Test ONE small piece of code on its own: no server, no database.
// Here: the business rules (rules.js) and the input checks (validate.js).
// They run in milliseconds, so they are the base of the testing pyramid.
// =====================================================================

const { decideClaim, STEPS, HOLD_HOURS } = require('../backend/rules');
const validate = require('../backend/validate');

describe('decideClaim (what to do with a claim)', () => {
  test('enough stock and enough need -> RESERVE', () => {
    // Arrange-Act-Assert in one line: ask 70, 100 free, need 70.
    expect(decideClaim(70, 100, 70)).toEqual({ result: 'RESERVE' });
  });

  test('asking for more than is free -> COUNTER with what is free', () => {
    expect(decideClaim(70, 30, 100)).toEqual({ result: 'COUNTER', offer: 30 });
  });

  test('the offer is also limited by what the NGO still needs', () => {
    expect(decideClaim(40, 100, 25)).toEqual({ result: 'COUNTER', offer: 25 });
  });

  test('nothing free -> NOTHING (we never offer 0)', () => {
    expect(decideClaim(5, 0, 50)).toEqual({ result: 'NOTHING' });
  });

  test('need already fully covered -> NOTHING', () => {
    expect(decideClaim(5, 100, 0)).toEqual({ result: 'NOTHING' });
  });

  test('asking for exactly what is free -> RESERVE', () => {
    expect(decideClaim(30, 30, 30)).toEqual({ result: 'RESERVE' });
  });
});

describe('STEPS (the life of a claim)', () => {
  test('a hold lasts 48 hours', () => {
    expect(HOLD_HOURS).toBe(48);
  });

  test('only cancel gives items back (pickup and later steps never do)', () => {
    expect(STEPS.cancel.givesBack).toBe(true);
    expect(STEPS.pickup.givesBack).toBeUndefined();
    expect(STEPS.receipt.givesBack).toBeUndefined();
  });

  test('cancelling is only possible before pickup', () => {
    expect(STEPS.cancel.from).toEqual(['HELD', 'CONFIRMED']);
    expect(STEPS.cancel.from).not.toContain('PICKED_UP');
  });

  test('the donor records pickup; the NGO does every other step', () => {
    expect(STEPS.pickup.who).toBe('DONOR');
    for (const name of ['confirm', 'cancel', 'deliver', 'receipt']) {
      expect(STEPS[name].who).toBe('NGO');
    }
  });

  test('the steps go in order: HELD -> CONFIRMED -> PICKED_UP -> DELIVERED -> RECEIVED', () => {
    expect(STEPS.confirm.from).toEqual(['HELD']);
    expect(STEPS.pickup.from).toEqual([STEPS.confirm.to]);
    expect(STEPS.deliver.from).toEqual([STEPS.pickup.to]);
    expect(STEPS.receipt.from).toEqual([STEPS.deliver.to]);
  });
});

describe('validate (checking input from outside)', () => {
  test('quantity accepts whole numbers from 1', () => {
    expect(validate.quantity(5, 'quantity')).toBe(5);
  });

  // test.each runs the same test once for every value in the list.
  test.each([0, -3, 2.5, '5', null, undefined, 100001])('quantity rejects %p', (value) => {
    // toThrow needs a FUNCTION to call, so we wrap the call in () => ...
    expect(() => validate.quantity(value, 'quantity')).toThrow('quantity must be a whole number');
  });

  test('text trims spaces and rejects empty text', () => {
    expect(validate.text('  Chairs  ', 'title')).toBe('Chairs');
    expect(() => validate.text('   ', 'title')).toThrow('title is required');
    expect(() => validate.text(42, 'title')).toThrow('title is required');
  });

  test('text rejects text that is too long', () => {
    expect(() => validate.text('x'.repeat(101), 'name')).toThrow('at most 100');
  });

  test('optionalText turns empty into null', () => {
    expect(validate.optionalText('', 'locality')).toBeNull();
    expect(validate.optionalText(undefined, 'locality')).toBeNull();
  });

  test('oneOf only allows listed values', () => {
    expect(validate.oneOf('HIGH', 'urgency', ['LOW', 'MEDIUM', 'HIGH'])).toBe('HIGH');
    expect(() => validate.oneOf('URGENT', 'urgency', ['LOW', 'MEDIUM', 'HIGH'])).toThrow('urgency must be one of');
  });

  test('id accepts "12" from a URL and rejects "abc" or 0', () => {
    expect(validate.id('12')).toBe(12);
    expect(() => validate.id('abc')).toThrow();
    expect(() => validate.id('0')).toThrow();
  });

  test('email is lowercased and must look like an email', () => {
    expect(validate.email('Asha@Example.COM')).toBe('asha@example.com');
    expect(() => validate.email('not-an-email')).toThrow('not a valid email');
  });

  test('a thrown validation error carries status 400', () => {
    try {
      validate.quantity(0, 'quantity');
    } catch (err) {
      expect(err.status).toBe(400);
    }
    expect.assertions(1);       // makes sure the catch block really ran
  });
});
