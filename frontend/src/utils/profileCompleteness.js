// Mirrored (by necessity - see validators.js) at
// backend/src/utils/profileCompleteness.js against the same shape
// GET /api/candidates/me returns. Computed fresh, never cached.
import { validateNationalId } from './validators';

const INTERNAL_PROFILE_FIELDS = ['employeeId', 'department', 'position', 'dateJoined', 'supervisorName', 'supervisorEmail'];

export function getMissingProfileFields(candidate) {
  const missing = [];
  if (!candidate) return ['location', 'workAuthorization', 'nationalId', 'education', 'workExperience'];

  if (!candidate.location) missing.push('location');
  if (!candidate.workAuthorization) missing.push('workAuthorization');

  if (!candidate.nationalId) {
    missing.push('nationalId');
  } else if (candidate.idType === 'NationalID' && !validateNationalId(candidate.nationalId)) {
    missing.push('nationalId');
  }

  if (!(candidate.education || []).length) missing.push('education');
  if (!(candidate.workExperience || []).length) missing.push('workExperience');

  if (candidate.candidateType === 'Internal') {
    const internalProfile = candidate.internalProfile || {};
    INTERNAL_PROFILE_FIELDS.forEach((field) => {
      if (!internalProfile[field]) missing.push(`internalProfile.${field}`);
    });
  }

  return missing;
}

export function isProfileComplete(candidate) {
  return getMissingProfileFields(candidate).length === 0;
}

// Denominator matches getMissingProfileFields' own checks: the 5 base
// fields it always checks (location, workAuthorization, nationalId,
// education, workExperience), plus INTERNAL_PROFILE_FIELDS when the
// candidate is Internal - so this stays in lockstep with that function's
// notion of "missing" without duplicating the field list.
const BASE_FIELD_COUNT = 5;

export function getProfileCompletionPercent(candidate) {
  if (!candidate) return 0;
  const total = BASE_FIELD_COUNT + (candidate.candidateType === 'Internal' ? INTERNAL_PROFILE_FIELDS.length : 0);
  const missing = getMissingProfileFields(candidate).length;
  return Math.round(((total - missing) / total) * 100);
}
