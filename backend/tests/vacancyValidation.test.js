const {
  validateVacancyEditableFields, VALID_POSTING_TYPES, VALID_EMPLOYMENT_CATEGORIES, VALID_LOCATIONS,
  normalizeDesirableRequirements, normalizeDisqualifyingRequirements, normalizeRequiredExamGrades
} = require('../src/utils/vacancyValidation');

// Title and department are no longer free-text here - since the Position
// table, they're derived from the selected Position and validated via
// positionModel lookups in the controller instead (see vacancyController.test.js).

describe('validateVacancyEditableFields - full creation (partial=false)', () => {
  test('accepts a fully valid payload with no errors', () => {
    const errors = validateVacancyEditableFields({ positionsRequired: 2, postingType: 'External', deadline: null });
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

describe('validateVacancyEditableFields - employmentCategory', () => {
  test('rejects a value outside the enum', () => {
    const errors = validateVacancyEditableFields({ employmentCategory: 'Bogus' });
    expect(errors).toContain(`Employment category must be one of: ${VALID_EMPLOYMENT_CATEGORIES.join(', ')}`);
  });

  test.each(VALID_EMPLOYMENT_CATEGORIES)('accepts %s', (employmentCategory) => {
    expect(validateVacancyEditableFields({ employmentCategory })).toEqual([]);
  });

  test('is skipped entirely when omitted, null, or empty string', () => {
    expect(validateVacancyEditableFields({})).toEqual([]);
    expect(validateVacancyEditableFields({ employmentCategory: null })).toEqual([]);
    expect(validateVacancyEditableFields({ employmentCategory: '' })).toEqual([]);
  });
});

describe('normalizeDesirableRequirements', () => {
  test('a plain yesno row omits answerType/minValue entirely', () => {
    const result = normalizeDesirableRequirements([{ id: '1', text: 'Willing to travel?' }]);
    expect(result[0]).toEqual({ id: '1', text: 'Willing to travel?' });
  });

  test('keeps a valid number row with its minValue, drops one with no usable minValue', () => {
    const result = normalizeDesirableRequirements([
      { id: '1', text: 'Years of volunteer experience?', answerType: 'number', minValue: 2 },
      { id: '2', text: 'No threshold', answerType: 'number', minValue: '' }
    ]);
    expect(result).toEqual([{ id: '1', text: 'Years of volunteer experience?', answerType: 'number', minValue: 2 }]);
  });
});

describe('normalizeDisqualifyingRequirements', () => {
  test('returns undefined when the field is absent (partial update untouched)', () => {
    expect(normalizeDisqualifyingRequirements(undefined)).toBeUndefined();
  });

  test('returns [] for a non-array value', () => {
    expect(normalizeDisqualifyingRequirements('not an array')).toEqual([]);
  });

  test('assigns a stable id when missing and keeps one that is present', () => {
    const result = normalizeDisqualifyingRequirements([
      { text: 'Are you 26 or younger?', requiredAnswer: 'Yes' },
      { id: 'kept-id', text: 'Do you hold a valid licence?', requiredAnswer: 'Yes' }
    ]);
    expect(result[0].id).toEqual(expect.any(String));
    expect(result[0].id.length).toBeGreaterThan(0);
    expect(result[1].id).toBe('kept-id');
  });

  test('drops rows with blank text', () => {
    const result = normalizeDisqualifyingRequirements([{ id: '1', text: '   ', requiredAnswer: 'Yes' }]);
    expect(result).toEqual([]);
  });

  test('defaults an invalid or missing requiredAnswer to Yes, but keeps an explicit No', () => {
    const result = normalizeDisqualifyingRequirements([
      { id: '1', text: 'Q1' },
      { id: '2', text: 'Q2', requiredAnswer: 'Bogus' },
      { id: '3', text: 'Q3', requiredAnswer: 'No' }
    ]);
    expect(result.map((r) => r.requiredAnswer)).toEqual(['Yes', 'Yes', 'No']);
  });

  test('a row with no answerType (or "yesno") omits answerType/minValue entirely - unchanged shape from before "number" existed', () => {
    const result = normalizeDisqualifyingRequirements([{ id: '1', text: 'Q1', requiredAnswer: 'Yes' }]);
    expect(result[0]).toEqual({ id: '1', text: 'Q1', requiredAnswer: 'Yes' });
  });

  test('keeps a valid number row with its minValue, drops one with no usable minValue', () => {
    const result = normalizeDisqualifyingRequirements([
      { id: '1', text: 'What is your CGPA?', answerType: 'number', minValue: 3, requiredAnswer: 'Yes' },
      { id: '2', text: 'No threshold', answerType: 'number', minValue: 'not-a-number', requiredAnswer: 'Yes' }
    ]);
    expect(result).toEqual([{ id: '1', text: 'What is your CGPA?', requiredAnswer: 'Yes', answerType: 'number', minValue: 3 }]);
  });
});

describe('validateVacancyEditableFields - minimumAge/maximumAge/minimumFlyingHours', () => {
  test('rejects zero, negative, and non-integer values for each', () => {
    expect(validateVacancyEditableFields({ minimumAge: 0 })).toContain('Minimum age must be a whole number of at least 1');
    expect(validateVacancyEditableFields({ maximumAge: -1 })).toContain('Maximum age must be a whole number of at least 1');
    expect(validateVacancyEditableFields({ minimumFlyingHours: 1.5 })).toContain('Minimum flying hours must be a whole number of at least 1');
  });

  test('rejects a minimum age greater than the maximum', () => {
    const errors = validateVacancyEditableFields({ minimumAge: 30, maximumAge: 20 });
    expect(errors).toContain('Minimum age cannot be greater than maximum age');
  });

  test('accepts a valid minimum <= maximum, and is skipped when omitted/null/empty', () => {
    expect(validateVacancyEditableFields({ minimumAge: 21, maximumAge: 26 })).toEqual([]);
    expect(validateVacancyEditableFields({ minimumAge: null, maximumAge: '', minimumFlyingHours: undefined })).toEqual([]);
  });
});

describe('validateVacancyEditableFields - minimumCGPA', () => {
  test('rejects zero, negative, non-numeric, and above-scale values', () => {
    expect(validateVacancyEditableFields({ minimumCGPA: 0 })).toContain('Minimum CGPA must be a number greater than 0 and at most 5');
    expect(validateVacancyEditableFields({ minimumCGPA: -1 })).toContain('Minimum CGPA must be a number greater than 0 and at most 5');
    expect(validateVacancyEditableFields({ minimumCGPA: 5.1 })).toContain('Minimum CGPA must be a number greater than 0 and at most 5');
    expect(validateVacancyEditableFields({ minimumCGPA: 'abc' })).toContain('Minimum CGPA must be a number greater than 0 and at most 5');
  });

  test('accepts a value on the 0-5 scale, including the upper bound, and is skipped when omitted/null/empty', () => {
    expect(validateVacancyEditableFields({ minimumCGPA: 3.5 })).toEqual([]);
    expect(validateVacancyEditableFields({ minimumCGPA: 5 })).toEqual([]);
    expect(validateVacancyEditableFields({ minimumCGPA: null })).toEqual([]);
    expect(validateVacancyEditableFields({ minimumCGPA: '' })).toEqual([]);
    expect(validateVacancyEditableFields({})).toEqual([]);
  });
});

describe('validateVacancyEditableFields - location', () => {
  // VALID_LOCATIONS only seeds the frontend dropdown's suggestions now - a
  // custom site (typed via the "Other" option) is equally valid, so this
  // is never rejected, unlike postingType/employmentCategory above.
  test('accepts a value outside the fixed site list - custom locations are allowed', () => {
    expect(validateVacancyEditableFields({ location: 'A New Aerodrome Not Yet Listed' })).toEqual([]);
  });

  test.each(VALID_LOCATIONS)('accepts %s', (location) => {
    expect(validateVacancyEditableFields({ location })).toEqual([]);
  });

  test('is skipped entirely when omitted, null, or empty string', () => {
    expect(validateVacancyEditableFields({})).toEqual([]);
    expect(validateVacancyEditableFields({ location: null })).toEqual([]);
    expect(validateVacancyEditableFields({ location: '' })).toEqual([]);
  });
});

describe('normalizeRequiredExamGrades', () => {
  test('returns undefined when absent, [] for a non-array', () => {
    expect(normalizeRequiredExamGrades(undefined)).toBeUndefined();
    expect(normalizeRequiredExamGrades('nope')).toEqual([]);
  });

  test('keeps a valid OLevel row and a valid ALevel row', () => {
    const result = normalizeRequiredExamGrades([
      { level: 'OLevel', subject: 'Mathematics', minGrade: '6' },
      { level: 'ALevel', subject: 'Physics', minGrade: 'C' }
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ level: 'OLevel', subject: 'Mathematics', minGrade: '6' });
    expect(result[1]).toMatchObject({ level: 'ALevel', subject: 'Physics', minGrade: 'C' });
  });

  test('drops a row with an invalid level, blank subject, or a grade from the wrong scale', () => {
    const result = normalizeRequiredExamGrades([
      { level: 'Bogus', subject: 'Mathematics', minGrade: '6' },
      { level: 'OLevel', subject: '   ', minGrade: '6' },
      { level: 'OLevel', subject: 'Mathematics', minGrade: 'C' }, // A-Level grade on an O-Level row
      { level: 'ALevel', subject: 'Physics', minGrade: '6' } // O-Level grade on an A-Level row
    ]);
    expect(result).toEqual([]);
  });

  test('assigns a stable id when missing and keeps one that is present', () => {
    const result = normalizeRequiredExamGrades([
      { level: 'OLevel', subject: 'Mathematics', minGrade: '6' },
      { id: 'kept-id', level: 'ALevel', subject: 'Physics', minGrade: 'C' }
    ]);
    expect(result[0].id).toEqual(expect.any(String));
    expect(result[1].id).toBe('kept-id');
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
