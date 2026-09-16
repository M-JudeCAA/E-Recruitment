// Minimum bar for a usable reference - a name plus a way to actually reach
// them. Shared between applicationDraftController.submit (the enforced
// "3 referees required before submitting" gate, replacing the old CV-upload
// requirement) and screeningService.screenApplication (the same check,
// kept only as an informational flag) so both apply the exact same
// definition of "a complete referee" rather than two copies drifting apart.
function countCompleteReferees(referees) {
  return (Array.isArray(referees) ? referees : []).filter((r) => r && r.name && r.phone && r.email).length;
}

module.exports = { countCompleteReferees };
