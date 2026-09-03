const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const offerModel = require('../models/offerModel');
const workflow = require('../services/workflowService');
const { fileUrl } = require('../middleware/upload');

async function submit(req, res) {
  const vacancyId = Number(req.body.vacancyId);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // NEW - previously a Closed or Filled vacancy, or one past its deadline,
  // would still silently accept new applications.
  if (vacancy.status === 'Closed' || vacancy.status === 'Filled') {
    return res.status(422).json({ error: 'This vacancy is no longer accepting applications' });
  }
  if (vacancy.deadline && vacancy.deadline < new Date()) {
    return res.status(422).json({ error: 'The application deadline for this vacancy has passed' });
  }

  if (req.user.candidateType === 'External' && vacancy.postingType === 'Internal') {
    return res.status(403).json({ error: 'This vacancy is open to internal candidates only' });
  }

  // NEW - previously nothing stopped the same candidate applying twice.
  // Matching @@unique([vacancyId, candidateId]) in the schema backstops
  // this against race conditions (e.g. a double-submitted request).
  const existing = await applicationModel.findFirst({ vacancyId, candidateId: req.user.id });
  if (existing) {
    return res.status(409).json({ error: 'You have already applied to this vacancy' });
  }

  const cvFile = req.files?.cv?.[0];
  if (!cvFile) return res.status(400).json({ error: 'A CV upload is required' });
  const coverLetterFile = req.files?.coverLetter?.[0];

  const application = await applicationModel.create({
    vacancyId,
    candidateId: req.user.id,
    cvUrl: fileUrl(cvFile),
    coverLetterUrl: fileUrl(coverLetterFile),
    status: 'Submitted',
    submittedDate: new Date()
  });

  await workflow.captureSnapshot({
    entityType: 'ApplicationSnapshot',
    entityId: application.id,
    candidateId: req.user.id
  });
  await workflow.notifySupervisor(application.id);

  res.status(201).json(application);
}

async function shortlist(req, res) {
  const applicationId = Number(req.params.id);
  try {
    await workflow.assertCanShortlist(applicationId);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const application = await applicationModel.update(applicationId, {
    status: 'Shortlisted', rank: req.body.rank, listStatus: req.body.listStatus
  });
  res.json(application);
}

async function approveShortlist(req, res) {
  const vacancyId = Number(req.params.vacancyId);
  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  res.json({ message: 'Shortlist approved', vacancyId });
}

// This was the missing step: Principal HR Officer reviews interview
// outcomes and formally recommends the candidate for an offer, creating
// the Offer row DHRA later approves. Nothing existed to do this before.
async function recommendOffer(req, res) {
  const applicationId = Number(req.params.id);

  const application = await applicationModel.findById(applicationId, { interviewRounds: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });

  const hasFinalizedInterview = application.interviewRounds.some((r) => r.score != null && r.recommendation);
  if (!hasFinalizedInterview) {
    return res.status(422).json({ error: 'This application has no finalized interview recommendation yet' });
  }

  let offer;
  try {
    offer = await offerModel.create({
      applicationId,
      status: 'Recommended',
      recommendedById: req.user.id
    });
  } catch (err) {
    // Offer.applicationId is unique - a second recommendation attempt
    // hits this instead of silently creating a duplicate.
    return res.status(409).json({ error: 'An offer has already been recommended for this application' });
  }

  await applicationModel.update(applicationId, { status: 'Offered' });
  res.status(201).json(offer);
}

async function approveOffer(req, res) {
  const offer = await offerModel.update(Number(req.params.offerId), {
    status: 'Approved', approvedById: req.user.id, approvedDate: new Date()
  });
  res.json(offer);
}

// Accept/decline are candidate actions on their own offer - previously
// these had no candidate-role check and no ownership check at all,
// meaning any authenticated user could accept or decline anyone's offer.
async function acceptOffer(req, res) {
  const offerId = Number(req.params.offerId);
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (existing.application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your offer' });
  }

  const offer = await offerModel.update(offerId, { status: 'Accepted' });
  await workflow.captureSnapshot({
    entityType: 'HireSnapshot',
    entityId: offer.id,
    candidateId: offer.application.candidateId,
    performedById: offer.approvedById
  });
  await workflow.recomputeVacancyStatus(offer.application.vacancyId);
  res.json(offer);
}

async function declineOffer(req, res) {
  const offerId = Number(req.params.offerId);
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (existing.application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your offer' });
  }

  const result = await workflow.handleOfferDeclined(offerId);
  res.json(result);
}

module.exports = { submit, shortlist, approveShortlist, recommendOffer, approveOffer, acceptOffer, declineOffer };
