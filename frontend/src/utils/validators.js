// Mirrored (by necessity - backend/ and frontend/ are separate
// package.json's with no shared workspace) at
// backend/src/utils/validators.js. Keep both in sync if either changes.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

// At least 8 chars, one lowercase, one uppercase, one digit, one symbol.
export const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Uganda National ID: 14 chars - 'C' (citizen) + 'F'/'M' (gender) + 2-digit
// birth year + 10 random alphanumeric characters.
export const NATIONAL_ID_RE = /^C[FM]\d{2}[A-Za-z0-9]{10}$/;

export function validateEmail(email) {
  return !!email && EMAIL_RE.test(email.trim());
}

export function validatePassword(password) {
  return !!password && PASSWORD_RE.test(password);
}

export function validateNationalId(nationalId) {
  return !!nationalId && NATIONAL_ID_RE.test(nationalId.trim());
}

export const PASSWORD_HINT = 'At least 8 characters, with an uppercase letter, a lowercase letter, a digit, and a symbol.';
// Deliberately doesn't describe the NIN format (C/F-M/birth year/etc.) -
// just flags the entry as wrong and asks for a correct one, rather than
// handing out the exact rule being checked against.
export const NATIONAL_ID_ERROR = 'That doesn\'t look like a valid National ID number. Please check and enter it again.';
