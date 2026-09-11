// Single source of truth for "is this candidate's profile complete".
// Mirrored (by necessity - see validators.js) at
// frontend/src/utils/profileCompleteness.js against the same shape
// GET /api/candidates/me returns. Computed fresh on every call rather
// than cached, since completeness depends on three independently-mutated
// pieces of state (Candidate fields, Education[], InternalProfile).
const { validateNationalId } = require('./validators');

const INTERNAL_PROFILE_FIELDS = ['employeeId', 'department', 'position', 'dateJoined', 'supervisorName', 'supervisorEmail'];

function getMissingProfileFields(candidate) {
  const missing = [];

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

function isProfileComplete(candidate) {
  return getMissingProfileFields(candidate).length === 0;
}

module.exports = { getMissingProfileFields, isProfileComplete };
