import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DEADLINE_TIME, deadlineValue, deadlineFields, formatDeadline, formatDeadlineTime
} from '../../src/utils/deadline';

// Mirrors backend utils/vacancyValidation.js parseDeadline: the form sends
// the day and closing time with no zone, read as Kampala time (UTC+3).
describe('deadline', () => {
  test('closes at 5:00pm unless a time is chosen', () => {
    expect(DEFAULT_DEADLINE_TIME).toBe('17:00');
    expect(deadlineValue('2026-05-29')).toBe('2026-05-29T17:00');
    expect(deadlineValue('2026-05-29', '12:30')).toBe('2026-05-29T12:30');
    expect(deadlineValue('')).toBe('');
  });

  test('a stored deadline fills the day and time in Kampala, whatever the browser zone', () => {
    expect(deadlineFields('2026-05-29T14:00:00.000Z')).toEqual({ date: '2026-05-29', time: '17:00' });
    // From before closing times were kept: the last moment of the day.
    expect(deadlineFields('2026-10-10T20:59:59.999Z')).toEqual({ date: '2026-10-10', time: '23:59' });
    expect(deadlineFields(null)).toEqual({ date: '', time: '17:00' });
  });

  test('shows the day with its closing time', () => {
    expect(formatDeadlineTime('2026-05-29T14:00:00.000Z')).toBe('5:00pm');
    expect(formatDeadline('2026-05-29T14:00:00.000Z')).toBe('29 May 2026, 5:00pm');
    expect(formatDeadline('2026-05-29T06:30:00.000Z')).toBe('29 May 2026, 9:30am');
    expect(formatDeadline(null)).toBe('');
  });
});
