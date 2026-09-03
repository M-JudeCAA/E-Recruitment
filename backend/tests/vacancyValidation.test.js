const { validateVacancyInput, VALID_POSTING_TYPES } = require('../src/utils/vacancyValidation');

describe('validateVacancyInput - full creation (partial=false)', () => {
  test('accepts a fully valid payload with no errors', () => {
    const errors = validateVacancyInput({
      title: 'AVSEC Officer', department: 'AVSEC', positionsRequired: 2,
      postingType: 'Open', deadline: null
    });
    expect(errors).toEqual([]);
  });

  test('rejects a missing title', () => {
    const errors = validateVacancyInput({ department: 'AVSEC' });
    expect(errors).toContain('Title is required');
  });

  test('rejects a whitespace-only title', () => {
    const errors = validateVacancyInput({ title: '   ', department: 'AVSEC' });
    expect(errors).toContain('Title is required');
  });

  test('rejects a missing department', () => {
    const errors = validateVacancyInput({ title: 'AVSEC Officer' });
    expect(errors).toContain('Department is required');
  });

  test('accumulates multiple errors at once', () => {
    const errors = validateVacancyInput({ positionsRequired: -1, postingType: 'Bogus' });
    expect(errors).toEqual(expect.arrayContaining([
      'Title is required',
      'Department is required',
      'Positions required must be a whole number of at least 1',
      `Posting type must be one of: ${VALID_POSTING_TYPES.join(', ')}`
    ]));
    expect(errors.length).toBe(4);
  });
});

describe('validateVacancyInput - positionsRequired', () => {
  test('rejects a negative number', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', positionsRequired: -1 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects zero', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', positionsRequired: 0 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects a non-integer value', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', positionsRequired: 1.5 });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('rejects a non-numeric string', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', positionsRequired: 'abc' });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });

  test('accepts a positive integer, including numeric strings', () => {
    expect(validateVacancyInput({ title: 't', department: 'd', positionsRequired: 3 })).toEqual([]);
    expect(validateVacancyInput({ title: 't', department: 'd', positionsRequired: '3' })).toEqual([]);
  });

  test('is skipped entirely when omitted', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd' });
    expect(errors).toEqual([]);
  });
});

describe('validateVacancyInput - postingType', () => {
  test('rejects a value outside the enum', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', postingType: 'Bogus' });
    expect(errors).toContain(`Posting type must be one of: ${VALID_POSTING_TYPES.join(', ')}`);
  });

  test.each(VALID_POSTING_TYPES)('accepts %s', (postingType) => {
    const errors = validateVacancyInput({ title: 't', department: 'd', postingType });
    expect(errors).toEqual([]);
  });
});

describe('validateVacancyInput - deadline', () => {
  test('rejects an unparsable date', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', deadline: 'not-a-date' });
    expect(errors).toContain('Deadline is not a valid date');
  });

  test('rejects a date in the past', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', deadline: '2000-01-01' });
    expect(errors).toContain('Deadline cannot be in the past');
  });

  test('accepts a future date', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const errors = validateVacancyInput({
      title: 't', department: 'd', deadline: future.toISOString()
    });
    expect(errors).toEqual([]);
  });

  test('accepts null as "no deadline"', () => {
    const errors = validateVacancyInput({ title: 't', department: 'd', deadline: null });
    expect(errors).toEqual([]);
  });
});

describe('validateVacancyInput - partial mode (edits)', () => {
  test('does not require title or department when they are absent from the payload', () => {
    const errors = validateVacancyInput({ positionsRequired: 2 }, { partial: true });
    expect(errors).toEqual([]);
  });

  test('still validates a field if it is present, even in partial mode', () => {
    const errors = validateVacancyInput({ title: '   ' }, { partial: true });
    expect(errors).toContain('Title is required');
  });

  test('still enforces positionsRequired rules in partial mode when the field is present', () => {
    const errors = validateVacancyInput({ positionsRequired: 0 }, { partial: true });
    expect(errors).toContain('Positions required must be a whole number of at least 1');
  });
});
