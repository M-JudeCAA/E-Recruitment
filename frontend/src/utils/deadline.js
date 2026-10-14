// Application deadlines: a day and a closing time in UCAA's time zone,
// 5:00pm unless HR changes it - as the adverts say ("not later than
// 5:00pm, 29th May 2026"). The forms send "YYYY-MM-DDTHH:mm" with no zone
// and the API reads the time as Kampala's (backend utils/vacancyValidation.js
// parseDeadline, DEFAULT_DEADLINE_TIME), so the fields are filled from a
// stored deadline in that zone too, whatever zone the browser is in.

export const DEFAULT_DEADLINE_TIME = '17:00';
export const APP_TIMEZONE = import.meta.env.VITE_APP_TIMEZONE || 'Africa/Kampala';

// What the forms send: the day, at the closing time.
export function deadlineValue(date, time) {
  if (!date) return '';
  return `${date}T${time || DEFAULT_DEADLINE_TIME}`;
}

// A stored deadline as the form's two fields, in APP_TIMEZONE.
export function deadlineFields(value) {
  if (!value) return { date: '', time: DEFAULT_DEADLINE_TIME };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date(value)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// "5:00pm"
export function formatDeadlineTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-US', { timeZone: APP_TIMEZONE, hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, '').toLowerCase();
}

// "29 September 2026", or "29 Sept 2026" with `long: false`.
export function formatDeadlineDay(value, { long = true } = {}) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { timeZone: APP_TIMEZONE, day: 'numeric', month: long ? 'long' : 'short', year: 'numeric' });
}

// "29 May 2026, 5:00pm"
export function formatDeadline(value, options) {
  if (!value) return '';
  return `${formatDeadlineDay(value, options)}, ${formatDeadlineTime(value)}`;
}
