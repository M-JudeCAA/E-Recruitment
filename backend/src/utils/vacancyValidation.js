const VALID_POSTING_TYPES = ['Internal', 'External', 'Open'];

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

module.exports = { validateVacancyEditableFields, VALID_POSTING_TYPES };
