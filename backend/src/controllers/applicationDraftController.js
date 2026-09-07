const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const workflow = require('../services/workflowService');
const { screenApplication } = require('../services/screeningService');
const { fileUrl } = require('../middleware/upload');
const {
  assertPostingTypeEligible, assertVacancyAcceptingApplications, assertBeforeDeadline
} = require('../utils/applicationEligibility');

// REPLACES the old single-step submit() entirely - having two parallel
// "create an application" code paths (one direct-to-Submitted, one
// draft-based) is exactly the kind of sibling-endpoint divergence this
// project has already been bitten by more than once. A candidate who
// wants to apply in one sitting just calls this, then immediately calls
// submit() below - two requests, but one shared set of eligibility
// checks, never two copies of the same logic drifting apart.
//
// Behaviour:
//  - No existing application for this (vacancy, candidate) pair -> create a new Draft.
//  - An existing Draft -> update it in place (this is how "keep editing
//    your draft" works - same endpoint, not a separate PATCH).
//  - An existing application in any OTHER status -> rejected. This is
//    what makes withdrawal a one-way door: a Withdrawn row still exists
//    for that (vacancyId, candidateId) pair, so it is found here and
//    rejected exactly like an already-Submitted one would be - no
//    special-casing needed, it falls out of the existing unique
//    constraint and this same branch.
async function saveDraft(req, res) {
  const vacancyId = Number(req.body.vacancyId);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  try {
    assertPostingTypeEligible(vacancy, req.user.candidateType);
    assertVacancyAcceptingApplications(vacancy);
    // Deliberately NOT calling assertBeforeDeadline here - a draft
    // started in good faith before the deadline can still be edited as
    // the deadline approaches or passes; only the transition to
    // Submitted (below) is actually blocked by it.
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const cvFile = req.files?.cv?.[0];
  const coverLetterFile = req.files?.coverLetter?.[0];

  // The wizard's Questions step - application-level (unlike the
  // candidate-level profile fields on Candidate, these vary per
  // application) - sent alongside the multipart draft-save request so a
  // single "Save as draft" persists everything the candidate has entered
  // so far, matching how cv/coverLetter already work.
  const { desiredSalary, openToRelocate, earliestStartDate, whyThisRole } = req.body;
  const questionsData = {};
  if (desiredSalary !== undefined) questionsData.desiredSalary = desiredSalary || null;
  if (openToRelocate !== undefined) questionsData.openToRelocate = openToRelocate || null;
  if (earliestStartDate !== undefined) questionsData.earliestStartDate = earliestStartDate ? new Date(earliestStartDate) : null;
  if (whyThisRole !== undefined) questionsData.whyThisRole = whyThisRole || null;

  const existing = await applicationModel.findFirst({ vacancyId, candidateId: req.user.id });

  if (existing) {
    if (existing.status !== 'Draft') {
      const message = existing.status === 'Withdrawn'
        ? 'You have already withdrawn from this vacancy and cannot re-apply'
        : 'You have already applied to this vacancy';
      return res.status(409).json({ error: message });
    }
    const data = { ...questionsData };
    if (cvFile) data.cvUrl = fileUrl(cvFile);
    if (coverLetterFile) data.coverLetterUrl = fileUrl(coverLetterFile);
    const updated = await applicationModel.update(existing.id, data);
    return res.json(updated);
  }

  const application = await applicationModel.create({
    vacancyId,
    candidateId: req.user.id,
    cvUrl: fileUrl(cvFile),
    coverLetterUrl: fileUrl(coverLetterFile),
    status: 'Draft',
    ...questionsData
  });
  res.status(201).json(application);
}

// The real gate - all three eligibility checks apply here, plus the one
// check that's specific to submission itself: a CV must actually be on
// file. This is the only place ApplicationSnapshot gets captured and the
// supervisor gets notified, matching the existing principle that those
// two things represent "what was true when the candidate committed to
// applying," not a work in progress.
async function submit(req, res) {
  const applicationId = Number(req.params.id);
  const application = await applicationModel.findById(applicationId);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your application' });
  }
  if (application.status !== 'Draft') {
    return res.status(422).json({ error: 'Only a draft application can be submitted' });
  }
  if (!application.cvUrl) {
    return res.status(400).json({ error: 'A CV upload is required before submitting' });
  }

  const vacancy = await vacancyModel.findById(application.vacancyId);
  try {
    assertPostingTypeEligible(vacancy, req.user.candidateType);
    assertVacancyAcceptingApplications(vacancy);
    assertBeforeDeadline(vacancy); // the one check draft-save deliberately skipped
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  // If HR has already opened this vacancy's review queue
  // (reviewStartedAt set), a late-but-valid applicant should join that
  // queue immediately, screened the same way the original batch was -
  // not sit invisibly at Submitted until someone remembers to re-run
  // Begin Review a second time.
  let data = { status: 'Submitted', submittedDate: new Date() };
  if (vacancy.reviewStartedAt) {
    const candidate = await candidateModel.findByIdWithRecords(req.user.id);
    const result = screenApplication(application, candidate, vacancy);
    data = {
      ...data, status: 'UnderReview',
      screeningPassed: result.passed, screeningReasons: JSON.stringify(result.reasons), screenedAt: new Date()
    };
  }

  const updated = await applicationModel.update(applicationId, data);

  await workflow.captureSnapshot({
    entityType: 'ApplicationSnapshot', entityId: applicationId, candidateId: req.user.id
  });
  await workflow.notifySupervisor(applicationId);

  res.json(updated);
}

// Limited deliberately to Draft/Submitted - withdrawing from Shortlisted
// or later has real cascade questions (does it free a Reserve slot? does
// it need the same care as the offer-decline cascade?) that belong with
// the shortlisting workflow, not here.
//
// Cancelling a Draft is NOT the same event as withdrawing a Submitted
// application, and the two are deliberately handled differently:
//   - A Draft was never seen by HR and never represented a real
//     commitment, so cancelling it deletes the row outright, freeing the
//     (vacancyId, candidateId) slot so the candidate can start a
//     genuinely fresh application to the same vacancy.
//   - A Submitted application is a real, HR-visible commitment the
//     candidate is backing out of - that stays a one-way door (row kept
//     as Withdrawn, re-applying to the same vacancy is refused), per
//     Decision #8 in the candidate application workflow spec.
async function withdraw(req, res) {
  const applicationId = Number(req.params.id);
  const application = await applicationModel.findById(applicationId);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your application' });
  }
  if (!['Draft', 'Submitted'].includes(application.status)) {
    return res.status(422).json({ error: 'This application can no longer be withdrawn' });
  }

  if (application.status === 'Draft') {
    await applicationModel.remove(applicationId);
    return res.json({ id: applicationId, vacancyId: application.vacancyId, cancelled: true });
  }

  const { reason } = req.body; // optional - candidate's prerogative, useful for HR reporting when given
  const updated = await applicationModel.update(applicationId, {
    status: 'Withdrawn', withdrawalReason: reason || null
  });
  res.json(updated);
}

module.exports = { saveDraft, submit, withdraw };
