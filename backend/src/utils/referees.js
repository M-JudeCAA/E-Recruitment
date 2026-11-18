const { validateEmail } = require('./validators');
const { phoneError } = require('./profileValidation');

// Minimum bar for a usable reference - a name plus a way to actually reach
// them: a valid phone number and email address. Shared between
// applicationSubmissionService (the enforced "3 referees required before
// submitting" gate) and screeningService.screenApplication (the same check,
// kept only as an informational flag) so both apply the exact same
// definition of "a complete referee" rather than two copies drifting apart.
// Mirrored for the Referees step at frontend/src/utils/profileValidation.js.
function refereeComplete(r) {
  return Boolean(r && r.name && String(r.name).trim() && r.phone && !phoneError(r.phone) && validateEmail(r.email || ''));
}

function countCompleteReferees(referees) {
  return (Array.isArray(referees) ? referees : []).filter(refereeComplete).length;
}

// What is wrong with the referees given, one message per problem, for the
// candidate: missing details, a phone or email that isn't one, the
// candidate's own email named as a referee's.
function refereeProblems(referees, ownEmail) {
  const list = Array.isArray(referees) ? referees : [];
  const own = String(ownEmail || '').trim().toLowerCase();
  const problems = [];
  for (let i = 0; i < 3; i += 1) {
    const r = list[i] || {};
    const who = `Referee ${i + 1}`;
    if (!String(r.name || '').trim() || !String(r.phone || '').trim() || !String(r.email || '').trim()) {
      problems.push(`${who}: name, phone and email are required.`);
      continue;
    }
    if (phoneError(r.phone)) problems.push(`${who}: the phone number is not valid.`);
    if (!validateEmail(r.email)) problems.push(`${who}: the email address is not valid.`);
    else if (own && String(r.email).trim().toLowerCase() === own) problems.push(`${who}: give the referee's email address, not your own.`);
  }
  return problems;
}

module.exports = { countCompleteReferees, refereeComplete, refereeProblems };
