// Mirrored (by necessity - see validators.js) at
// backend/src/utils/profileCompleteness.js against the same shape
// GET /api/candidates/me returns. Computed fresh, never cached.
import { validateNationalId } from './validators';

const INTERNAL_PROFILE_FIELDS = ['employeeId', 'department', 'position', 'dateJoined', 'supervisorName', 'supervisorEmail'];

export function getMissingProfileFields(candidate) {
  const missing = [];
  if (!candidate) return ['location', 'workAuthorization', 'nationalId', 'education'];

  if (!candidate.location) missing.push('location');
  if (!candidate.workAuthorization) missing.push('workAuthorization');

  if (!candidate.nationalId) {
    missing.push('nationalId');
  } else if (candidate.idType === 'NationalID' && !validateNationalId(candidate.nationalId)) {
    missing.push('nationalId');
  }

  if (!(candidate.education || []).length) missing.push('education');

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
