// Single source of truth for "is this candidate's profile complete".
// Mirrored (by necessity - see validators.js) at
// frontend/src/utils/profileCompleteness.js against the same shape
// GET /api/candidates/me returns. Computed fresh on every call rather
// than cached, since completeness depends on three independently-mutated
// pieces of state (Candidate fields, Education[], InternalProfile).
const { validateNationalId } = require('./validators');

const INTERNAL_PROFILE_FIELDS = ['employeeId', 'department', 'position', 'dateJoined'];

function getMissingProfileFields(candidate) {
  const missing = [];

  if (!candidate.location) missing.push('location');
  if (!candidate.districtOfOrigin) missing.push('districtOfOrigin');

  // External candidates: the NIN is the only identity document accepted - a
  // missing or invalid one (including a passport number from before passports
  // were dropped) leaves the profile incomplete. Internal candidates give
  // their employee number instead (internalProfile.employeeId, below).
  if (candidate.candidateType !== 'Internal' && !validateNationalId(candidate.nationalId)) missing.push('nationalId');

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

function isProfileComplete(candidate) {
  return getMissingProfileFields(candidate).length === 0;
}

module.exports = { getMissingProfileFields, isProfileComplete };
