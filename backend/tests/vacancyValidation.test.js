const { validateVacancyEditableFields, VALID_POSTING_TYPES } = require('../src/utils/vacancyValidation');

// Title and department are no longer free-text here - since the Position
// table, they're derived from the selected Position and validated via
// positionModel lookups in the controller instead (see vacancyController.test.js).

describe('validateVacancyEditableFields - full creation (partial=false)', () => {
  test('accepts a fully valid payload with no errors', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 2, postingType: 'Open', deadline: null });
    expect(errors).toEqual([]);
  });

  test('accepts an empty payload (positionsRequired/postingType/deadline are all optional here)', () => {
    expect(validateVacancyEditableFields({})).toEqual([]);
  });

  test('accumulates multiple errors at once', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: -1, postingType: 'Bogus' });
    expect(errors).toEqual(expect.arrayContaining([
      'Positions required must be a whole number of at least 1',
      `Posting type must be one of: ${VALID_POSTING_TYPES.join(', ')}`
    ]));
    expect(errors.length).toBe(2);
  });
});

describe('validateVacancyEditableFields - positionsRequired', () => {
  test('rejects a negative number', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: -1 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects zero', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 0 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects a non-integer value', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 1.5 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects a non-numeric string', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 'abc' });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('accepts a positive integer, including numeric strings', () => {
    expect(validateVacancyEditableFields({ positionsRequired: 3 })).toEqual([]);
    expect(validateVacancyEditableFields({ positionsRequired: '3' })).toEqual([]);
  });

  test('is skipped entirely when omitted', () => {
    expect(validateVacancyEditableFields({})).toEqual([]);
  });
});

describe('validateVacancyEditableFields - postingType', () => {
  test('rejects a value outside the enum', () => {
    const errors = validateVacancyEditableFields({ postingType: 'Bogus' });
    expect(errors).toContain(`Posting type must be one of: ${VALID_POSTING_TYPES.join(', ')}`);
  });

  test.each(VALID_POSTING_TYPES)('accepts %s', (postingType) => {
    const errors = validateVacancyEditableFields({ postingType });
    expect(errors).toEqual([]);
  });
});

describe('validateVacancyEditableFields - deadline', () => {
  test('rejects an unparsable date', () => {
    const errors = validateVacancyEditableFields({ deadline: 'not-a-date' });
    expect(errors).toContain('Deadline is not a valid date');
  });

  test('rejects a date in the past', () => {
    const errors = validateVacancyEditableFields({ deadline: '2000-01-01' });
    expect(errors).toContain('Deadline cannot be in the past');
  });

  test('accepts a future date', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const errors = validateVacancyEditableFields({ deadline: future.toISOString() });
    expect(errors).toEqual([]);
  });

  test('accepts null as "no deadline"', () => {
    const errors = validateVacancyEditableFields({ deadline: null });
    expect(errors).toEqual([]);
  });
});

describe('validateVacancyEditableFields - partial mode (edits)', () => {
  test('accepts an empty payload', () => {
    const errors = validateVacancyEditableFields({}, { partial: true });
    expect(errors).toEqual([]);
  });

  test('still enforces positionsRequired rules in partial mode when the field is present', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 0 }, { partial: true });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });
});
