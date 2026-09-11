const candidateModel = require('../models/candidateModel');
const { isProfileComplete } = require('../utils/profileCompleteness');
const { notifyCandidate } = require('./candidateNotificationService');

// Completeness can tip over from any of three independent endpoints
// (updateProfile, addEducation, updateInternalProfile) - so this is called
// at the end of all three rather than living inside just one of them.
// profileCompletedAt guards against firing more than once, ever, even
// though it's called unconditionally from all three call sites.
async function checkAndFireCompletionEvent(candidateId) {
  const candidate = await candidateModel.findById(candidateId, { education: true, internalProfile: true });
  if (!candidate || candidate.profileCompletedAt) return;
  if (!isProfileComplete(candidate)) return;

  await candidateModel.update(candidateId, { profileCompletedAt: new Date() });
  await notifyCandidate(candidateId, 'ProfileCompleted', 'Your profile is complete. You can now be considered for vacancies.');
}

module.exports = { checkAndFireCompletionEvent };
