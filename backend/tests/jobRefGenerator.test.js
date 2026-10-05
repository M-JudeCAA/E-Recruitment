const { typeCodeFor, refYear, formatJobRef } = require('../src/utils/jobRefGenerator');

describe('typeCodeFor', () => {
  test('maps Internal to INT', () => {
    expect(typeCodeFor('Internal')).toBe('INT');
  });
  test('maps External to EXT', () => {
    expect(typeCodeFor('External')).toBe('EXT');
  });
});

describe('formatJobRef', () => {
  test('matches UCAA/ADV/{TYPE}/{NNN}/{YYYY}, zero-padding the number to three digits', () => {
    expect(formatJobRef('EXT', 7, 2026)).toBe('UCAA/ADV/EXT/007/2026');
    expect(formatJobRef('INT', 123, 2026)).toBe('UCAA/ADV/INT/123/2026');
  });

  test('lets a number past 999 grow rather than truncating it', () => {
    expect(formatJobRef('EXT', 1000, 2026)).toBe('UCAA/ADV/EXT/1000/2026');
  });
});

describe('refYear', () => {
  const original = process.env.APP_TIMEZONE;
  afterEach(() => { process.env.APP_TIMEZONE = original; });

  test('takes the year in APP_TIMEZONE, not UTC', () => {
    process.env.APP_TIMEZONE = 'Africa/Kampala'; // UTC+3
    expect(refYear(new Date('2026-12-31T22:30:00Z'))).toBe(2027);
    expect(refYear(new Date('2026-12-31T20:30:00Z'))).toBe(2026);
  });

  test('falls back to the UTC year on an invalid APP_TIMEZONE', () => {
    process.env.APP_TIMEZONE = 'Not/AZone';
    expect(refYear(new Date('2026-06-01T00:00:00Z'))).toBe(2026);
  });
});
