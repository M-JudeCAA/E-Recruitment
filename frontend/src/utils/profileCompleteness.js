// Mirrored (by necessity - see validators.js) at
// backend/src/utils/profileCompleteness.js against the same shape
// GET /api/candidates/me returns. Computed fresh, never cached.
import { validateNationalId } from './validators';

const INTERNAL_PROFILE_FIELDS = ['employeeId', 'department', 'position', 'dateJoined'];

export function getMissingProfileFields(candidate) {
  const missing = [];
  if (!candidate) return ['location', 'districtOfOrigin', 'nationalId', 'education', 'workExperience'];

  if (!candidate.location) missing.push('location');
  if (!candidate.districtOfOrigin) missing.push('districtOfOrigin');

  // External candidates: the NIN is the only identity document accepted.
  // Internal candidates give their employee number instead (below).
  const internal = candidate.candidateType === 'Internal';
  if (!internal && !validateNationalId(candidate.nationalId)) missing.push('nationalId');

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

// Denominator matches getMissingProfileFields' own checks: location,
// districtOfOrigin, education and workExperience for everyone; nationalId for
// External candidates; INTERNAL_PROFILE_FIELDS for Internal ones - so this
// stays in lockstep with that function's notion of "missing".
const BASE_FIELD_COUNT = 4;

export function getProfileCompletionPercent(candidate) {
  if (!candidate) return 0;
  const total = BASE_FIELD_COUNT + (candidate.candidateType === 'Internal' ? INTERNAL_PROFILE_FIELDS.length : 1);
  const missing = getMissingProfileFields(candidate).length;
  return Math.round(((total - missing) / total) * 100);
}
