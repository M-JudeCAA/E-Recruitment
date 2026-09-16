const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const { screenApplication, scoreApplication, evaluateEssentialCriteria } = require('../services/screeningService');

// Explicit staff action (not a side effect of viewing the list, and not
// per-candidate) - matches how every other meaningful transition in this
// system works (approve, close, the vacancy review gate). Idempotent:
// safe to click more than once, since it only ever touches applications
// currently sitting at Submitted - already-screened ones are untouched.
async function beginReview(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (!vacancy.reviewStartedAt) {
    await vacancyModel.update(vacancyId, { reviewStartedAt: new Date() });
  }

  const pending = await applicationModel.findByVacancyAndStatus(vacancyId, 'Submitted');

  // Parallelized (was a sequential for-of, 2 DB round-trips per applicant -
  // a real N+1 that blocked the whole request on a large batch) via
  // allSettled rather than Promise.all, since one malformed candidate
  // record must not take down screening for every other applicant in the
  // batch - each application is independently idempotent to retry anyway
  // (only Submitted ones are ever touched), so a partial failure just means
  // re-clicking Begin Review picks up whatever didn't make it.
  const outcomes = await Promise.allSettled(pending.map(async (application) => {
    const candidate = await candidateModel.findByIdWithRecords(application.candidateId);
    const result = screenApplication(application, candidate, vacancy);
    const score = scoreApplication(application, candidate, vacancy);
    const essentialCriteria = evaluateEssentialCriteria(candidate, vacancy);
    await applicationModel.update(application.id, {
      status: 'UnderReview',
      screeningPassed: result.passed,
      screeningReasons: JSON.stringify(result.reasons),
      screenedAt: new Date(),
      fieldOfStudyMatch: result.fieldOfStudyMatch,
      shortlistScore: score.score,
      shortlistScoreReasons: JSON.stringify(score.reasons),
      essentialCriteriaResults: JSON.stringify(essentialCriteria)
    });
  }));

  const screened = outcomes.filter((o) => o.status === 'fulfilled').length;
  const failed = outcomes.length - screened;
  if (failed > 0) {
    outcomes.filter((o) => o.status === 'rejected').forEach((o) => console.error('Begin Review: failed to screen an application:', o.reason));
  }

  res.json({ vacancyId, screened, failed });
}

module.exports = { beginReview };
