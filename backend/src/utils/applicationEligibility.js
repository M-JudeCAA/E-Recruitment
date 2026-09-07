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

function assertPostingTypeEligible(vacancy, candidateType) {
  if (candidateType === 'External' && vacancy.postingType === 'Internal') {
    throw new Error('This vacancy is open to internal candidates only');
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
