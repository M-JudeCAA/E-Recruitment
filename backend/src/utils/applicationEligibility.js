// Three independent checks, each throwing a plain Error with a
// candidate-facing message. Deliberately NOT combined into one function -
// draft-save and submit() need different subsets of these (see the
// comments at each call site), and this project has already hit the
// exact failure mode of a check existing in one endpoint but not its
// sibling more than once (saveRanking's permission tier, the retired
// role reference surviving in two scripts). Keeping these as small,
// independently-callable pieces makes it obvious at each call site
// exactly which checks are and aren't being applied, rather than one
// endpoint quietly inheriting an all-or-nothing bundle.

// CHANGED - strict bidirectional match, not a one-way block. Previously
// only External candidates were blocked from Internal vacancies; an
// Internal (staff) account could still apply to an External vacancy
// using their work account, since nothing checked that direction at all.
// Now that PostingType.Open is gone, a vacancy is always exactly one or
// the other - so a mismatch in either direction is blocked. A staff
// member wanting to apply to an External vacancy now needs their own,
// separate External account, matching policy exactly.
function assertPostingTypeEligible(vacancy, candidateType) {
  if (vacancy.postingType !== candidateType) {
    throw new Error(candidateType === 'Internal'
      ? 'This vacancy is open to external candidates only'
      : 'This vacancy is open to internal candidates only');
  }
}

function assertVacancyAcceptingApplications(vacancy) {
  if (vacancy.status === 'Closed' || vacancy.status === 'Filled') {
    throw new Error('This vacancy is no longer accepting applications');
  }
}

function assertBeforeDeadline(vacancy) {
  if (vacancy.deadline && vacancy.deadline < new Date()) {
    throw new Error('The application deadline for this vacancy has passed');
  }
}

module.exports = { assertPostingTypeEligible, assertVacancyAcceptingApplications, assertBeforeDeadline };
