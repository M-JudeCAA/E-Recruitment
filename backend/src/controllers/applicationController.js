const applicationModel = require('../models/applicationModel');
const offerModel = require('../models/offerModel');
const slaModel = require('../models/slaModel');
const workflow = require('../services/workflowService');

// NOTE: application creation/submission lives in applicationDraftController
// now (saveDraft/submit/withdraw) - see routes/applications.js. This file
// keeps everything downstream of a Submitted application.

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
      recommendedById: req.user.id,
      recommendedDate: new Date() // needed for SLA timing - see checkSlaEscalations.js
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
  const offerId = Number(req.params.offerId);
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });

  const offer = await offerModel.update(offerId, {
    status: 'Approved', approvedById: req.user.id, approvedDate: new Date()
  });
  // The spec defines slaModel.resolveEscalations but never calls it
  // anywhere - without this, an escalated OfferApproval task would stay
  // "active" (resolvedAt: null) forever even after being decided.
  await slaModel.resolveEscalations('OfferApproval', offerId);
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

module.exports = { shortlist, approveShortlist, recommendOffer, approveOffer, acceptOffer, declineOffer };
