import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  PHONE_ERROR, phoneError, certificateDatesError, workDatesError, yearCompletedError, dateOfBirthError,
  dateJoinedError, normalizeUrl, refereeProblems, refereeEmailError, safeHref
} from '../../src/utils/profileValidation';

// The same rules as backend/src/utils/profileValidation.js (and referees.js),
// shown as the candidate fills a field in. "Today" is 18 November 2026.

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-18T09:00:00Z')); });
afterAll(() => vi.useRealTimers());

describe('phone numbers', () => {
  test.each(['0772 123456', '+256 772 123456', '256772123456', '+44 20 7946 0958'])('accepts %s', (p) => expect(phoneError(p)).toBeNull());
  test.each(['abc', '0772ABC456', '0772 12345', '+0772123456'])('refuses %s', (p) => expect(phoneError(p)).toBe(PHONE_ERROR));
});

describe('dates', () => {
  test('certificate expiry after issue; issue not in the future', () => {
    expect(certificateDatesError({ issueDate: '2024-05-01', expiryDate: '2023-05-01' })).toMatch(/after the issue date/);
    expect(certificateDatesError({ issueDate: '2026-12-01', expiryDate: '' })).toMatch(/future/);
    expect(certificateDatesError({ issueDate: '2024-05-01', expiryDate: '2030-05-01' })).toBeNull();
  });
  test('work experience, education, date of birth, date joined', () => {
    expect(workDatesError({ startDate: '2027-01-01' })).toMatch(/future/);
    expect(workDatesError({ startDate: '2020-01-01', endDate: '2019-01-01' })).toMatch(/before the start date/);
    expect(yearCompletedError(2027)).toMatch(/future/);
    expect(dateOfBirthError('2008-11-19')).toMatch(/at least 18/);
    expect(dateOfBirthError('2008-11-18')).toBeNull();
    expect(dateJoinedError('2026-12-01')).toMatch(/future/);
  });
});

describe('links', () => {
  test('https:// added; only http(s) addresses are opened', () => {
    expect(normalizeUrl('grace.dev')).toEqual({ value: 'https://grace.dev' });
    expect(normalizeUrl('my site').error).toBeTruthy();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('linkedin.com/in/grace')).toBe('https://linkedin.com/in/grace');
  });
});

describe('referees', () => {
  test('each problem is named, the candidate\'s own email included', () => {
    const refs = [
      { name: 'A', phone: '07ab123456', email: 'a@example.com' },
      { name: 'B', phone: '0772123456', email: 'nope' },
      { name: 'C', phone: '0772123456', email: 'me@example.com' }
    ];
    expect(refereeProblems(refs, 'Me@example.com')).toEqual([
      'Referee 1: the phone number is not valid.',
      'Referee 2: the email address is not valid.',
      "Referee 3: give the referee's email address, not your own."
    ]);
    expect(refereeEmailError('me@example.com', 'me@example.com')).toMatch(/not your own/);
    expect(refereeEmailError('', 'me@example.com')).toBeNull();
  });
});
