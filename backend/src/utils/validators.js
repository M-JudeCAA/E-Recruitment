// Shared format validators for candidate auth/profile input. Mirrored (by
// necessity, not by choice - backend/ and frontend/ are separate
// package.json's with no shared workspace) at
// frontend/src/utils/validators.js. Keep both in sync if either changes.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

// At least 8 chars, one lowercase, one uppercase, one digit, one symbol.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

// Uganda National ID: 14 chars - 'C' (citizen) + 'F'/'M' (gender) + 2-digit
// birth year + 10 random alphanumeric characters.
const NATIONAL_ID_RE = /^C[FM]\d{2}[A-Za-z0-9]{10}$/;

function validateEmail(email) {
  return !!email && EMAIL_RE.test(email.trim());
}

function validatePassword(password) {
  return !!password && PASSWORD_RE.test(password);
}

function validateNationalId(nationalId) {
  return !!nationalId && NATIONAL_ID_RE.test(nationalId.trim());
}

module.exports = { validateEmail, validatePassword, validateNationalId, EMAIL_RE, PASSWORD_RE, NATIONAL_ID_RE };
