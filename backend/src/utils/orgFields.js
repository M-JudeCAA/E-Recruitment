// The short code and full name every directorate, department and position
// carries (DHRA - Human Resource and Administration; HRO - Human Resource
// Officer), checked the same way on the forms, on edit and in the import.
// Mirrored in frontend/src/utils/orgFields.js.

const CODE_MAX = 20;
const NAME_MAX = 191;
// Letters and digits, with spaces, &, /, . and - inside (MGT ACCT, IT INT).
const CODE_RE = /^[A-Z0-9](?:[A-Z0-9 &/.-]*[A-Z0-9.])?$/;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normalizeCode = (v) => clean(v).toUpperCase();

// Error text for a code (already normalised), or null when it is fine.
function codeError(code, word) {
  if (!code) return `The ${word}'s short code is required`;
  if (code.length > CODE_MAX) return `The ${word}'s short code can be at most ${CODE_MAX} characters`;
  if (!CODE_RE.test(code)) return `The ${word}'s short code can only have letters, digits, spaces and & / . -`;
  return null;
}

function nameError(name, word) {
  if (!name) return `The ${word}'s full name is required`;
  if (name.length > NAME_MAX) return `The ${word}'s full name can be at most ${NAME_MAX} characters`;
  return null;
}

module.exports = { CODE_MAX, NAME_MAX, CODE_RE, clean, normalizeCode, codeError, nameError };
