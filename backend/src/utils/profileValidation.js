// What a candidate's profile and referees must look like: phone numbers,
// dates that can't be in the future or out of order, web links. Each rule
// returns an error message (for the candidate) or null. Mirrored at
// frontend/src/utils/profileValidation.js, which shows the same messages as
// a field is filled in - keep both in step.
//
// Dates are compared as calendar days ('YYYY-MM-DD'), today being the day in
// APP_TIMEZONE, so a date typed in Kampala is never "tomorrow" on the server.

const MIN_AGE = 18;
const MAX_AGE = 100;
const EARLIEST_YEAR = 1950;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// 'YYYY-MM-DD' for a date given as a day or a full timestamp; '' when empty;
// null when it isn't a real date ("2026-02-30", "abc").
function dayOf(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : String(value).trim();
  const m = DAY_RE.exec(text);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return m[0].slice(0, 10);
}

const addYears = (day, years) => `${String(Number(day.slice(0, 4)) + years).padStart(4, '0')}${day.slice(4)}`;

// Phone numbers: digits with spaces, dashes, brackets and a leading +, no
// letters. A Ugandan number is 0 + 9 digits or 256 + 9 digits (with or
// without the +); any other country is + its code, 8 to 15 digits in all.
const PHONE_CHARS_RE = /^\+?[0-9\s\-()]+$/;
const PHONE_ERROR = 'Enter a valid phone number - digits only, e.g. 0772 123456 or +256 772 123456 (or + and the country code for a number outside Uganda).';

function phoneError(phone) {
  const text = String(phone ?? '').trim();
  if (!text) return null;
  if (!PHONE_CHARS_RE.test(text)) return PHONE_ERROR;
  const digits = text.replace(/\D/g, '');
  const plus = text.startsWith('+');
  if (digits.startsWith('256')) return digits.length === 12 ? null : PHONE_ERROR;
  if (!plus && digits.startsWith('0')) return digits.length === 10 ? null : PHONE_ERROR;
  if (plus && digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0')) return null;
  return PHONE_ERROR;
}

// A date the candidate gives about the past: a real date, not after today.
function pastDayError(value, label) {
  const day = dayOf(value);
  if (day === null) return `${label} is not a valid date.`;
  if (day && day > today()) return `${label} can't be in the future.`;
  return null;
}

function certificateDatesError({ issueDate, expiryDate }) {
  const issued = dayOf(issueDate);
  const expires = dayOf(expiryDate);
  if (issued === null) return 'Issue date is not a valid date.';
  if (expires === null) return 'Expiry date is not a valid date.';
  if (issued && issued > today()) return "Issue date can't be in the future.";
  if (issued && expires && expires <= issued) return 'Expiry date must be after the issue date.';
  return null;
}

function workDatesError({ startDate, endDate }) {
  const start = dayOf(startDate);
  const end = dayOf(endDate);
  if (start === null) return 'Start date is not a valid date.';
  if (!start) return 'Start date is required.';
  if (end === null) return 'End date is not a valid date.';
  if (start > today()) return "Start date can't be in the future.";
  if (end && end > today()) return "End date can't be in the future - leave it blank if this is your current job.";
  if (end && end < start) return "End date can't be before the start date.";
  return null;
}

function yearCompletedError(year) {
  if (year === undefined || year === null || year === '') return null;
  const n = Number(year);
  const thisYear = Number(today().slice(0, 4));
  if (!Number.isInteger(n) || n < EARLIEST_YEAR) return `Year completed must be a year from ${EARLIEST_YEAR}.`;
  if (n > thisYear) return "Year completed can't be in the future - leave it blank if you are still studying.";
  return null;
}

function dateOfBirthError(value) {
  const day = dayOf(value);
  if (day === null) return 'Date of birth is not a valid date.';
  if (!day) return null;
  const now = today();
  if (day > now) return "Date of birth can't be in the future.";
  if (addYears(day, MIN_AGE) > now) return `You must be at least ${MIN_AGE} years old.`;
  if (addYears(day, MAX_AGE) < now) return 'Check your date of birth - it gives an age over 100.';
  return null;
}

function dateJoinedError(value, dateOfBirth) {
  const err = pastDayError(value, 'Date joined UCAA');
  if (err) return err;
  const joined = dayOf(value);
  const born = dayOf(dateOfBirth);
  if (joined && born && joined <= born) return "Date joined UCAA can't be before your date of birth.";
  return null;
}

// A web link (LinkedIn, portfolio): https:// added when left out; only
// http(s) addresses with a real host name. { value } ('' when empty) or { error }.
function normalizeUrl(url, label = 'Link') {
  const text = String(url ?? '').trim();
  if (!text) return { value: '' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let parsed;
  try { parsed = new URL(withScheme); } catch { return { error: `${label} is not a valid web address.` }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || !/^[^.\s]+(\.[^.\s]+)+$/.test(parsed.hostname) || /\s/.test(text)) {
    return { error: `${label} is not a valid web address.` };
  }
  return { value: withScheme };
}

module.exports = {
  MIN_AGE, MAX_AGE, PHONE_ERROR, today, dayOf, phoneError, pastDayError, certificateDatesError,
  workDatesError, yearCompletedError, dateOfBirthError, dateJoinedError, normalizeUrl
};
