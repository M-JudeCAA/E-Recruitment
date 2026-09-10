const crypto = require('crypto');

const VALID_POSTING_TYPES = ['Internal', 'External']; // 'Open' REMOVED - a vacancy is always exactly one or the other now

// Normalizers for the structured advert fields (Job Purpose / Person
// Specification). Deliberately lenient rather than error-throwing - a
// stray blank row from the list editor UI is dropped rather than
// rejected, the same tolerance already given to other optional fields
// elsewhere in this file. Each returns `undefined` when the field wasn't
// present in the payload at all, so a partial update (edit) never wipes
// a section the caller didn't touch, and an empty array `[]` when the
// caller explicitly sent one, so a section can still be deliberately
// cleared.
function normalizeStringList(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

// [{ id, text }] - `id` is generated once and kept stable across edits so
// a candidate's already-submitted Yes/No answer (which snapshots this id
// alongside the text at answer time) stays attributable even if the
// vacancy's wording is later tweaked. A row missing an id (a brand-new
// one from the "add requirement" button) gets one assigned here.
function normalizeDesirableRequirements(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      id: row?.id ? String(row.id) : crypto.randomUUID(),
      text: String(row?.text ?? '').trim()
    }))
    .filter((row) => row.text);
}

/**
 * Validates vacancy input. When partial=true (used for edits), a field is
 * only checked if it's actually present in the payload - required-ness
 * only applies to full creation.
 *
 * Title and department are no longer free-text fields here - since the
 * Position table, they're derived from the selected Position (see
 * vacancyController.create/update) and validated there via positionModel
 * lookups instead.
 */
function validateVacancyEditableFields(data, { partial = false } = {}) {
  const errors = [];
  const { positionsRequired, postingType, deadline } = data;

  if (positionsRequired !== undefined) {
    const n = Number(positionsRequired);
    // Explicitly rejects negative numbers and zero - the previous
    // `positionsRequired || 1` fallback let negative numbers straight
    // through, which broke the "is this vacancy filled" calculation.
    if (!Number.isInteger(n) || n < 1) {
      errors.push('Positions required must be a whole number of at least 1');
    }
  }

  if (postingType !== undefined && !VALID_POSTING_TYPES.includes(postingType)) {
    errors.push(`Posting type must be one of: ${VALID_POSTING_TYPES.join(', ')}`);
  }

  if (deadline !== undefined && deadline !== null) {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) {
      errors.push('Deadline is not a valid date');
    } else if (d < new Date(new Date().toDateString())) {
      errors.push('Deadline cannot be in the past');
    }
  }

  return errors;
}

module.exports = {
  validateVacancyEditableFields, VALID_POSTING_TYPES,
  normalizeStringList, normalizeDesirableRequirements
};
