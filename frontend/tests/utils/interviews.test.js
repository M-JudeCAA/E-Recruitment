import {
  addDays, endOf, errorMessage, fromLocalInput, isWeekend, outsideWorkingHours, resultsDue, sameDay, startOfWeek,
  timeRange, toLocalInput, venueLabel
} from '../../src/utils/interviews';
import { ratingLabel } from '../../src/utils/shortlistCommittee';

// Local wall-clock times: the scheduler works in the user's own time zone.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('interview rounds', () => {
  test('results are due once a scheduled interview\'s time has passed', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    expect(resultsDue({ status: 'Scheduled', scheduledDate: past })).toBe(true);
    expect(resultsDue({ status: 'Scheduled', scheduledDate: future })).toBe(false);
    expect(resultsDue({ status: 'Scheduled', scheduledDate: null })).toBe(false);
    expect(resultsDue({ status: 'Completed', scheduledDate: past })).toBe(false);
    expect(resultsDue({ status: 'Cancelled', scheduledDate: past })).toBe(false);
  });

  test('a round ends after its duration, an hour by default', () => {
    const start = at(2031, 3, 4, 9);
    expect(endOf({ scheduledDate: start, durationMinutes: 45 })).toEqual(at(2031, 3, 4, 9, 45));
    expect(endOf({ scheduledDate: start })).toEqual(at(2031, 3, 4, 10));
    expect(endOf({ scheduledDate: null })).toBeNull();
  });

  test('its time range', () => {
    expect(timeRange({ scheduledDate: at(2031, 3, 4, 10), durationMinutes: 45 })).toBe('10:00 - 10:45');
    expect(timeRange({ scheduledDate: null })).toBe('Time to be confirmed');
  });

  test('where it is held', () => {
    expect(venueLabel({ mode: 'In-person', location: 'Board Room' })).toBe('Board Room');
    expect(venueLabel({ mode: 'In-person' })).toBe('Venue to be confirmed');
    expect(venueLabel({ mode: 'Virtual', meetingLink: 'https://meet.example/x' })).toBe('Online');
    expect(venueLabel({ mode: 'Virtual' })).toBe('Online (link to follow)');
    expect(venueLabel({ mode: 'Phone', location: 'ignored' })).toBe('Phone');
  });
});

describe('the scheduler\'s date handling', () => {
  test('a date-time field round-trips through the API\'s ISO strings', () => {
    const local = '2031-03-04T09:30';
    expect(toLocalInput(fromLocalInput(local))).toBe(local);
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBeNull();
  });

  test('weekends', () => {
    expect(isWeekend(at(2031, 3, 1))).toBe(true); // Saturday
    expect(isWeekend(at(2031, 3, 2))).toBe(true); // Sunday
    expect(isWeekend(at(2031, 3, 4))).toBe(false); // Tuesday
  });

  test('a slot outside 08:00-17:00, or across midnight, is flagged', () => {
    expect(outsideWorkingHours(at(2031, 3, 4, 8), at(2031, 3, 4, 17))).toBe(false);
    expect(outsideWorkingHours(at(2031, 3, 4, 7, 30), at(2031, 3, 4, 8, 30))).toBe(true);
    expect(outsideWorkingHours(at(2031, 3, 4, 16, 30), at(2031, 3, 4, 17, 15))).toBe(true);
    expect(outsideWorkingHours(at(2031, 3, 4, 16), at(2031, 3, 5, 9))).toBe(true);
  });

  test('weeks start on Monday', () => {
    expect(startOfWeek(at(2031, 3, 6, 15))).toEqual(at(2031, 3, 3)); // Thursday -> Monday
    expect(startOfWeek(at(2031, 3, 9, 23))).toEqual(at(2031, 3, 3)); // Sunday -> the Monday before
    expect(startOfWeek(at(2031, 3, 3, 0))).toEqual(at(2031, 3, 3));
  });

  test('adding days crosses months, and leaves the date it was given alone', () => {
    const day = at(2031, 1, 30, 9);
    expect(addDays(day, 3)).toEqual(at(2031, 2, 2, 9));
    expect(day).toEqual(at(2031, 1, 30, 9));
  });

  test('the same day, whatever the time', () => {
    expect(sameDay(at(2031, 3, 4, 8), at(2031, 3, 4, 23, 59))).toBe(true);
    expect(sameDay(at(2031, 3, 4, 23, 59), at(2031, 3, 5, 0))).toBe(false);
  });
});

test('the message shown for a failed request is the API\'s, else the screen\'s own', () => {
  expect(errorMessage({ response: { data: { error: 'Interview clashes with another' } } }, 'Could not save')).toBe('Interview clashes with another');
  expect(errorMessage(new Error('Network Error'), 'Could not save')).toBe('Could not save');
  expect(errorMessage(undefined, 'Could not save')).toBe('Could not save');
});

describe('how a committee rating reads', () => {
  test('essential criteria: met, partly met, not met', () => {
    expect(ratingLabel({ kind: 'Essential' }, 2)).toBe('Met');
    expect(ratingLabel({ kind: 'Essential' }, 1)).toBe('Partly met');
    // 0 is a rating, not "no rating".
    expect(ratingLabel({ kind: 'Essential' }, 0)).toBe('Not met');
  });

  test('desirable criteria: the score and what it means', () => {
    expect(ratingLabel({ kind: 'Desirable' }, 5)).toBe('5 - Outstanding');
    expect(ratingLabel({ kind: 'Desirable' }, 1)).toBe('1 - Poor');
  });

  test('not rated yet', () => {
    expect(ratingLabel({ kind: 'Essential' }, null)).not.toBe('Not met');
    expect(ratingLabel({ kind: 'Desirable' }, undefined)).not.toMatch(/undefined/);
  });
});
