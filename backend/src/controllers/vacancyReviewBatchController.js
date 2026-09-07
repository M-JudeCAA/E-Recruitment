const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const { screenApplication } = require('../services/screeningService');

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

  let screened = 0;
  for (const application of pending) {
    const candidate = await candidateModel.findByIdWithRecords(application.candidateId);
    const result = screenApplication(application, candidate, vacancy);
    await applicationModel.update(application.id, {
      status: 'UnderReview',
      screeningPassed: result.passed,
      screeningReasons: JSON.stringify(result.reasons),
      screenedAt: new Date()
    });
    screened++;
  }

  res.json({ vacancyId, screened });
}

module.exports = { beginReview };
