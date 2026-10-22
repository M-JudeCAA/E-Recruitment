// HR's check of an internal candidate's UCAA employment details
// (InternalProfile.verificationStatus) - the one rule for whether it is done.
// Verified means HR_Verified with its evidence on file (comments or a
// manager's recommendation letter). An internal candidate submits an
// application only once verified (applicationDraftController.submit), and is
// shortlisted only once verified (workflowService.assertCanShortlist).
// External candidates have no such check.

const MESSAGES = {
  Pending: 'HR is checking your UCAA employment details. You can submit applications once they are verified - you can prepare this one in the meantime.',
  Discrepancy_Flagged: 'HR found a problem with your UCAA employment details. Check them on your profile (changing them sends them back to HR) or contact HR. You can submit applications once they are verified.',
  Missing: 'Add your UCAA employment details on your profile - HR checks them before you can submit applications.'
};

function isVerified(profile) {
  return Boolean(profile && profile.verificationStatus === 'HR_Verified' && profile.verificationEvidenceType);
}

/**
 * Where a candidate stands: { required, verified, status, message }.
 * status is Pending / HR_Verified / Discrepancy_Flagged, or Missing when an
 * internal candidate has no employment details yet.
 */
function employmentCheck(candidate) {
  if (!candidate || candidate.candidateType !== 'Internal') return { required: false, verified: true, status: null, message: null };
  const profile = candidate.internalProfile;
  const status = !profile || !profile.departmentId ? 'Missing' : profile.verificationStatus;
  const verified = isVerified(profile);
  return {
    required: true,
    verified,
    status: verified ? 'HR_Verified' : status === 'HR_Verified' ? 'Pending' : status,
    message: verified ? null : MESSAGES[status === 'HR_Verified' ? 'Pending' : status] || MESSAGES.Pending
  };
}

module.exports = { employmentCheck, isVerified };
