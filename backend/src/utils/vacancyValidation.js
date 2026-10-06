const crypto = require('crypto');
const { dayBounds } = require('./interviewFormat');

// The deadline as stored. The forms send a plain day ("2026-10-10"), which
// means the whole of that day in APP_TIMEZONE - so it is kept as the last
// millisecond of the day there. Read as `new Date(day)` it would be UTC
// midnight, closing applications at 03:00 Kampala time on the deadline day.
// A full timestamp is kept as sent. Returns null for no deadline, and an
// Invalid Date for something that isn't a date.
const PLAIN_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDeadline(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && PLAIN_DAY_RE.test(value.trim())) {
    return new Date(dayBounds(value.trim()).end.getTime() - 1);
  }
  return new Date(value);
}

const VALID_POSTING_TYPES = ['Internal', 'External']; // 'Open' REMOVED - a vacancy is always exactly one or the other now
const VALID_EMPLOYMENT_CATEGORIES = ['FullTime', 'Contract', 'FixedTermContract'];
// UCAA's actual sites - confirmed against a real reference "Create Job"
// form, same source as VALID_EMPLOYMENT_CATEGORIES/the qualification
// level list. A plain validated string, not a DB enum, since a new
// aerodrome opening shouldn't require a migration - just this array.
const VALID_LOCATIONS = [
  'Entebbe International Airport', 'UCAA Head Office — Entebbe', 'Kampala HQ',
  'Gulu Aerodrome', 'Jinja Aerodrome', 'Mbarara Aerodrome', 'Fort Portal (Kasese) Aerodrome',
  'Arua Aerodrome', 'Soroti Aerodrome', 'Kidepo Aerodrome'
];
const VALID_SECONDARY_LEVELS = ['OLevel', 'ALevel'];
const O_LEVEL_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const A_LEVEL_GRADES = ['A', 'B', 'C', 'D', 'E', 'O', 'F'];

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

// A row's answerType decides how its value fields are read - 'yesno' (the
// default, for every row created before 'number' existed) or 'number' (a
// free-text question with a numeric answer and a minValue threshold, e.g.
// "What is your CGPA?"). Shared by both normalizers below since the two
// requirement lists differ only in requiredAnswer.
function normalizeAnswerType(row) {
  return row?.answerType === 'number' ? 'number' : 'yesno';
}

// A question HR marked as needing evidence: a candidate who answers Yes
// (or a number above 0) must upload it (utils/screeningEvidence.js), as
// described by evidenceLabel.
function evidenceFields(row) {
  if (!row?.evidenceRequired) return {};
  const label = String(row.evidenceLabel ?? '').trim().slice(0, 150);
  return { evidenceRequired: true, ...(label ? { evidenceLabel: label } : {}) };
}

// Number(null) and Number('') both coerce to 0, not "absent" - read the
// raw value first so a row with no minValue actually set (as opposed to a
// genuine 0.0 threshold) normalizes to NaN and gets dropped below, not
// silently kept as a 0 threshold nothing could ever fail.
function parseMinValue(row) {
  const raw = row?.minValue;
  if (raw === null || raw === undefined || raw === '') return NaN;
  return Number(raw);
}

// [{ id, text, answerType?, minValue? }] - `id` is generated once and kept
// stable across edits so a candidate's already-submitted answer (which
// snapshots this id alongside the text at answer time) stays attributable
// even if the vacancy's wording is later tweaked. A row missing an id (a
// brand-new one from the "add requirement" button) gets one assigned here.
// A 'number' row with no usable minValue is dropped outright, same as
// normalizeRequiredExamGrades drops a row with no safe default - there's
// no sane threshold to fall back to.
function normalizeDesirableRequirements(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const answerType = normalizeAnswerType(row);
      const minValue = parseMinValue(row);
      return {
        id: row?.id ? String(row.id) : crypto.randomUUID(),
        text: String(row?.text ?? '').trim(),
        ...(answerType === 'number' ? { answerType, minValue } : {}),
        ...evidenceFields(row)
      };
    })
    .filter((row) => row.text && (row.answerType !== 'number' || Number.isFinite(row.minValue)));
}

// [{ id, text, requiredAnswer: 'Yes'|'No', answerType?, minValue? }] - same
// id-stability principle as normalizeDesirableRequirements, plus a
// requiredAnswer per row (the answer that PASSES screening, 'yesno' rows
// only) since not every eligibility question is naturally phrased so "Yes"
// is always the correct one. Defaults an invalid/missing requiredAnswer to
// 'Yes' rather than rejecting the whole row, matching this file's existing
// lenient-normalizer convention - minValue on a 'number' row gets the same
// drop-rather-than-default treatment as normalizeDesirableRequirements,
// since a wrong default threshold would silently gate real candidates.
function normalizeDisqualifyingRequirements(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const answerType = normalizeAnswerType(row);
      const minValue = parseMinValue(row);
      return {
        id: row?.id ? String(row.id) : crypto.randomUUID(),
        text: String(row?.text ?? '').trim(),
        requiredAnswer: row?.requiredAnswer === 'No' ? 'No' : 'Yes',
        ...(answerType === 'number' ? { answerType, minValue } : {}),
        ...evidenceFields(row)
      };
    })
    .filter((row) => row.text && (row.answerType !== 'number' || Number.isFinite(row.minValue)));
}

// [{ id, level, subject, minGrade }] - same id-stability principle as
// normalizeDesirableRequirements. A row with an invalid level, blank
// subject, or a minGrade that doesn't belong to that level's scale is
// dropped rather than defaulted - unlike requiredAnswer above, there's no
// safe default grade to fall back to.
function normalizeRequiredExamGrades(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => ({
      id: row?.id ? String(row.id) : crypto.randomUUID(),
      level: row?.level,
      subject: String(row?.subject ?? '').trim(),
      minGrade: row?.minGrade
    }))
    .filter((row) =>
      VALID_SECONDARY_LEVELS.includes(row.level) &&
      row.subject &&
      (row.level === 'OLevel' ? O_LEVEL_GRADES : A_LEVEL_GRADES).includes(row.minGrade)
    );
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
  const { positionsRequired, postingType, deadline, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA } = data;

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

  if (employmentCategory !== undefined && employmentCategory !== null && employmentCategory !== ''
    && !VALID_EMPLOYMENT_CATEGORIES.includes(employmentCategory)) {
    errors.push(`Employment category must be one of: ${VALID_EMPLOYMENT_CATEGORIES.join(', ')}`);
  }

  // No longer validated against VALID_LOCATIONS - that list only seeds the
  // dropdown of common sites now; HR can also type a custom one (a new
  // site not yet on the list) via the frontend's "Other" option, so any
  // non-empty string is accepted here rather than rejected.

  if (deadline !== undefined && deadline !== null) {
    const d = parseDeadline(deadline);
    if (!d || isNaN(d.getTime())) {
      errors.push('Deadline is not a valid date');
    } else if (d < new Date()) {
      errors.push('Deadline cannot be in the past');
    }
  }

  if (minimumAge !== undefined && minimumAge !== null && minimumAge !== '') {
    const n = Number(minimumAge);
    if (!Number.isInteger(n) || n < 1) errors.push('Minimum age must be a whole number of at least 1');
  }
  if (maximumAge !== undefined && maximumAge !== null && maximumAge !== '') {
    const n = Number(maximumAge);
    if (!Number.isInteger(n) || n < 1) errors.push('Maximum age must be a whole number of at least 1');
  }
  if (minimumAge && maximumAge && Number(minimumAge) > Number(maximumAge)) {
    errors.push('Minimum age cannot be greater than maximum age');
  }
  if (minimumFlyingHours !== undefined && minimumFlyingHours !== null && minimumFlyingHours !== '') {
    const n = Number(minimumFlyingHours);
    if (!Number.isInteger(n) || n < 1) errors.push('Minimum flying hours must be a whole number of at least 1');
  }
  // 0-5 scale, matching the reference "Create Job" form's Minimum CGPA
  // field (min=0, max=5, step=0.1) - Uganda's public universities
  // overwhelmingly grade on a 5.0 scale, so this isn't configurable.
  if (minimumCGPA !== undefined && minimumCGPA !== null && minimumCGPA !== '') {
    const n = Number(minimumCGPA);
    if (!Number.isFinite(n) || n <= 0 || n > 5) errors.push('Minimum CGPA must be a number greater than 0 and at most 5');
  }

  return errors;
}

// FR-ATS-032: an advert asks at most this many screening questions -
// Qualifying (desirableRequirements) and Disqualifying together. Mirrored
// in frontend/src/components/ScreeningQuestionsEditor.jsx.
const MAX_SCREENING_QUESTIONS = 5;

// An error message, or null. `previousCount` lets a vacancy created before
// the cap be edited as long as the edit doesn't add questions.
function screeningQuestionCountError(desirable, disqualifying, previousCount = 0) {
  const count = (Array.isArray(desirable) ? desirable.length : 0) + (Array.isArray(disqualifying) ? disqualifying.length : 0);
  if (count <= MAX_SCREENING_QUESTIONS || count <= previousCount) return null;
  return `An advert can ask at most ${MAX_SCREENING_QUESTIONS} screening questions (Qualifying and Disqualifying together) - this one has ${count}.`;
}

module.exports = {
  MAX_SCREENING_QUESTIONS, screeningQuestionCountError,
  validateVacancyEditableFields, parseDeadline, VALID_POSTING_TYPES, VALID_EMPLOYMENT_CATEGORIES, VALID_LOCATIONS,
  VALID_SECONDARY_LEVELS, O_LEVEL_GRADES, A_LEVEL_GRADES,
  normalizeStringList, normalizeDesirableRequirements, normalizeDisqualifyingRequirements, normalizeRequiredExamGrades
};
