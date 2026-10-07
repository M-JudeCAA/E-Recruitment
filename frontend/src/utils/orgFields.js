// The short code and full name every directorate, department and position
// carries - the same checks as backend/src/utils/orgFields.js, so a form can
// say what is wrong before it is sent. The API decides.

export const CODE_MAX = 20;
const CODE_RE = /^[A-Z0-9](?:[A-Z0-9 &/.-]*[A-Z0-9.])?$/;

export const normalizeCode = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export function codeError(value, word) {
  const code = normalizeCode(value);
  if (!code) return `Give the ${word}'s short code`;
  if (code.length > CODE_MAX) return `At most ${CODE_MAX} characters`;
  if (!CODE_RE.test(code)) return 'Only letters, digits, spaces and & / . -';
  return null;
}

/** "Human Resource (HR)", or just the name when the code is missing or the same. */
export function codeAndName(item) {
  if (!item) return '';
  return item.code && item.code.toUpperCase() !== String(item.name || '').toUpperCase() ? `${item.name} (${item.code})` : (item.name || item.code || '');
}
