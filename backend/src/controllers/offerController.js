const conflictOfInterest = require('../services/conflictOfInterestService');
const prisma = require('../config/db');
const offerModel = require('../models/offerModel');
const slaModel = require('../models/slaModel');
const vacancyModel = require('../models/vacancyModel');
const workflow = require('../services/workflowService');
const offerService = require('../services/offerService');
const audit = require('../services/auditService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { notify, notifyAllWithRole } = require('../services/notificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { toPublicVacancy } = require('../utils/publicVacancy');
const { sendError } = require('../utils/errorResponse');
const { formatWhen, escapeHtml } = require('../utils/interviewFormat');

// Offer management - see offerService.js for the lifecycle. Everything
// here is downstream of an approved merit list (meritListController).

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function describeVacancy(vacancy) {
  return vacancy ? `${vacancy.jobRef} (${vacancy.title})` : 'a vacancy';
}

// Notifications are a side effect of an action that has already committed -
// a failure here must never turn it into a 500.
async function safely(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`Failed to send ${label}:`, err);
  }
}

// GET /api/applications/:id/offer-draft - what the offer form starts from.
async function draft(req, res) {
  const applicationId = parseId(req.params.id);
  if (!applicationId) return res.status(400).json({ error: 'Invalid application id' });
  try {
    res.json(await offerService.draftContext(applicationId));
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/applications/:id/recommend-offer - Principal HR Officer+, only
// for a Primary candidate on the approved merit list, with the offer terms.
async function recommend(req, res) {
  const applicationId = parseId(req.params.id);
  if (!applicationId) return res.status(400).json({ error: 'Invalid application id' });
  let offer;
  try {
    offer = await offerService.recommend(applicationId, req.body, req.user.id);
  } catch (err) {
    return sendError(res, err);
  }
  await audit.record({
    entityType: 'Offer', entityId: offer.id, action: 'Offer recommended', actor: audit.actorFrom(req),
    details: { applicationId, terms: offerService.termsOf(offer) }
  });
  await audit.record({
    entityType: 'Application', entityId: applicationId, action: 'Offer recommended', actor: audit.actorFrom(req),
    details: { offerId: offer.id }
  });
  broadcastDashboardEvent('OfferPendingApproval', { offerId: offer.id });
  res.status(201).json(offer);
}

// PATCH /api/applications/offers/:offerId - revise the terms of an offer
// that hasn't been issued yet; a Returned offer goes back for approval.
async function revise(req, res) {
  const offerId = parseId(req.params.offerId);
  if (!offerId) return res.status(400).json({ error: 'Invalid offer id' });
  let result;
  try {
    result = await offerService.revise(offerId, req.body, req.user.id);
  } catch (err) {
    return sendError(res, err);
  }
  await audit.record({
    entityType: 'Offer', entityId: offerId, action: result.previousStatus === 'Returned' ? 'Offer revised and resubmitted' : 'Offer terms revised',
    actor: audit.actorFrom(req), before: result.before, after: result.offer, fields: [...offerService.TERM_FIELDS, 'status']
  });
  // A fresh submission restarts the approval clock.
  await slaModel.resolveEscalations('OfferApproval', offerId);
  broadcastDashboardEvent('OfferPendingApproval', { offerId });
  res.json(result.offer);
}

// Manager/Director Approvals Center - every offer awaiting approval.
async function listPendingApproval(req, res) {
  const { page, limit } = req.query;
  const take = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const pageNum = Math.max(Number(page) || 1, 1);
  const excludeVacancyIds = await conflictOfInterest.conflictedVacancyIds(req);
  const [data, total] = await Promise.all([
    offerModel.findManyPendingApproval({ skip: (pageNum - 1) * take, take, excludeVacancyIds }),
    offerModel.countPendingApproval(excludeVacancyIds)
  ]);
  res.json({ data, total, page: pageNum, limit: take });
}

const LIST_STATUSES = ['Recommended', 'Returned', 'Approved', 'Accepted', 'Declined', 'Expired', 'Withdrawn'];

// GET /api/applications/offers - the cross-vacancy offer tracker.
async function list(req, res) {
  const { status, vacancyId, expiringSoon, page, limit } = req.query;
  if (status && !LIST_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
  if (vacancyId !== undefined && !parseId(vacancyId)) return res.status(400).json({ error: 'Invalid vacancyId filter' });
  const take = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const pageNum = Math.max(Number(page) || 1, 1);
  const excludeVacancyIds = await conflictOfInterest.conflictedVacancyIds(req);
  if (vacancyId && excludeVacancyIds.includes(Number(vacancyId))) {
    const err = new conflictOfInterest.ApplicantConflictError();
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  const result = await offerService.list({
    status: status || undefined, vacancyId: vacancyId ? Number(vacancyId) : undefined,
    expiringSoon: expiringSoon === 'true', skip: (pageNum - 1) * take, take, excludeVacancyIds
  });
  res.json({ ...result, page: pageNum, limit: take });
}

// PATCH /api/applications/offers/:offerId/approve - Manager+, never the
// recommender. Issues the offer to the candidate with its response deadline.
async function approve(req, res) {
  const offerId = parseId(req.params.offerId);
  if (!offerId) return res.status(400).json({ error: 'Invalid offer id' });
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (existing.status !== 'Recommended') {
    return res.status(422).json({ error: `An offer at status "${existing.status}" cannot be approved` });
  }
  try {
    workflow.assertNotSelfApprovedOffer(existing, req.user.id);
  } catch (err) {
    return sendError(res, err, 422);
  }

  let deadline;
  try {
    deadline = await offerService.approve(existing, req.user.id);
  } catch (err) {
    return sendError(res, err);
  }
  const offer = await offerModel.findById(offerId);
  await audit.record({
    entityType: 'Offer', entityId: offerId, action: 'Offer approved and issued', actor: audit.actorFrom(req),
    before: existing, after: offer, fields: ['status', 'responseDeadline']
  });
  await slaModel.resolveEscalations('OfferApproval', offerId);
  // Approved is the moment the candidate can act, so the moment they're told.
  await safely(`offer notice for offer ${offerId}`, () => notifyCandidate(
    offer.application.candidateId, 'OfferReceived',
    `Congratulations! You have been offered the position of "${offer.application.vacancy.title}"`
    + (offerService.describeSalary(offer) ? ` at ${offerService.describeSalary(offer)}` : '')
    + `. Please log in to review the terms and accept or decline by ${formatWhen(deadline)}.`
  ));
  broadcastDashboardEvent('OfferApproved', { offerId });
  res.json(offer);
}

// PATCH /api/applications/offers/:offerId/return - Manager+ sends an offer
// back to its recommender with what needs to change.
async function returnForRevision(req, res) {
  const offerId = parseId(req.params.offerId);
  if (!offerId) return res.status(400).json({ error: 'Invalid offer id' });
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  let reason;
  try {
    reason = await offerService.returnForRevision(offerId, req.body?.reason, req.user.id);
  } catch (err) {
    return sendError(res, err);
  }
  await audit.record({
    entityType: 'Offer', entityId: offerId, action: 'Offer returned for revision', actor: audit.actorFrom(req),
    before: existing, after: { status: 'Returned' }, fields: ['status'], comment: reason
  });
  await slaModel.resolveEscalations('OfferApproval', offerId);
  if (existing.recommendedById) {
    await safely(`OfferReturned notification for offer ${offerId}`, () => notify(existing.recommendedById, 'OfferReturned', offerId,
      `The offer for application #${existing.applicationId} on ${describeVacancy(existing.application.vacancy)} was returned for revision: `
      + `${escapeHtml(reason)}`));
  }
  broadcastDashboardEvent('OfferReturned', { offerId });
  res.json(await offerModel.findById(offerId));
}

// Accept/decline are the owning candidate's actions on an issued offer.
async function loadOwnIssuedOffer(req, res, verb) {
  const offerId = parseId(req.params.offerId);
  if (!offerId) { res.status(400).json({ error: 'Invalid offer id' }); return null; }
  const existing = await offerModel.findById(offerId);
  if (!existing) { res.status(404).json({ error: 'Offer not found' }); return null; }
  if (existing.application.candidateId !== req.user.id) { res.status(403).json({ error: 'This is not your offer' }); return null; }
  if (existing.status !== 'Approved') {
    res.status(422).json({ error: `An offer at status "${existing.status}" cannot be ${verb}` });
    return null;
  }
  // The expiry job may not have run yet - a lapsed offer is closed either way.
  if (existing.responseDeadline && existing.responseDeadline <= new Date()) {
    res.status(409).json({ error: `The deadline to respond to this offer passed on ${formatWhen(existing.responseDeadline)}. Please contact HR.` });
    return null;
  }
  return existing;
}

async function accept(req, res) {
  const existing = await loadOwnIssuedOffer(req, res, 'accepted');
  if (!existing) return;
  const offerId = existing.id;

  const result = await workflow.acceptOfferTransactionally(offerId, existing.application.vacancyId);
  if (result.conflict) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }
  if (result.full) {
    // The candidate is told to contact HR - make sure HR already knows.
    await safely('VacancyFilledWithOpenOffers notification', () => notifyAllWithRole('Principal_HR_Officer', 'VacancyFilledWithOpenOffers', offerId,
      `A candidate tried to accept their offer for ${describeVacancy(existing.application.vacancy)} (application #${existing.applicationId}), `
      + 'but every position is already filled, so the acceptance was refused. Withdraw the offer, or raise the number of positions if another hire is wanted.'));
    return res.status(409).json({ error: 'All positions for this vacancy have already been filled, so this offer can no longer be accepted. Please contact HR.' });
  }
  const offer = result.offer;
  await audit.record({
    entityType: 'Offer', entityId: offerId, action: 'Offer accepted by the candidate', actor: audit.actorFrom(req),
    before: existing, after: offer, fields: ['status']
  });

  await safely(`hire snapshot for offer ${offerId}`, () => workflow.captureSnapshot({
    entityType: 'HireSnapshot', entityId: offer.id, candidateId: offer.application.candidateId, performedById: offer.approvedById
  }));
  // If this acceptance filled the vacancy, any other offer still in play on
  // it can no longer be accepted - flag them to HR now.
  await safely(`open-offer check after offer ${offerId}`, async () => {
    const vacancy = await vacancyModel.findById(offer.application.vacancyId);
    if (vacancy?.status !== 'Filled') return;
    const openOffers = await offerModel.findOpenForVacancy(vacancy.id, offer.id);
    if (openOffers.length === 0) return;
    const names = openOffers
      .map((o) => `${o.application.candidate?.fullName || 'a candidate'} (application #${o.applicationId}, offer ${o.status})`)
      .join('; ');
    await notifyAllWithRole('Principal_HR_Officer', 'VacancyFilledWithOpenOffers', vacancy.id,
      `${describeVacancy(vacancy)} is now filled, but ${openOffers.length} other offer${openOffers.length === 1 ? ' is' : 's are'} still open: ${names}. `
      + 'They can no longer be accepted. Withdraw them, or raise the number of positions if more hires are wanted.');
  });
  broadcastDashboardEvent('OfferAccepted', { offerId });
  // The candidate is the caller - candidate-safe shapes only.
  res.json({
    ...offerService.toCandidateOffer(offer),
    application: { id: offer.application.id, vacancy: toPublicVacancy(offer.application.vacancy) }
  });
}

async function decline(req, res) {
  const existing = await loadOwnIssuedOffer(req, res, 'declined');
  if (!existing) return;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) || null : null;

  const result = await workflow.handleOfferDeclined(existing.id, reason);
  if (result.conflict) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }
  await audit.record({
    entityType: 'Offer', entityId: existing.id, action: 'Offer declined by the candidate', actor: audit.actorFrom(req),
    before: existing, after: { status: 'Declined' }, fields: ['status'], comment: reason,
    details: { promotedApplicationId: result.promoted?.id || null }
  });
  await offerService.notifyPositionReleased('OfferDeclined', existing.id, existing.application.vacancy, existing.applicationId,
    `was declined${reason ? ` (reason given: ${escapeHtml(reason)})` : ''}`, result.promoted);
  broadcastDashboardEvent('OfferDeclined', { offerId: existing.id });
  // result.promoted is another applicant's row - never returned to this candidate.
  res.json({ message: 'Offer declined' });
}

// PATCH /api/applications/offers/:offerId/withdraw - Principal HR Officer+
// takes back an offer that is still open. Like a decline, it releases the
// position to the next reserve (unless the vacancy is already filled). The
// candidate is only told if the offer had been issued to them.
async function withdraw(req, res) {
  const offerId = parseId(req.params.offerId);
  if (!offerId) return res.status(400).json({ error: 'Invalid offer id' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (!offerService.OPEN_STATUSES.includes(existing.status)) {
    return res.status(422).json({ error: `An offer at status "${existing.status}" cannot be withdrawn` });
  }

  const result = await workflow.closeOffer(offerId, [existing.status], {
    status: 'Withdrawn', decidedAt: new Date(), withdrawnById: req.user.id, withdrawalReason: reason || null
  });
  if (result.conflict) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }

  await audit.record({
    entityType: 'Offer', entityId: offerId, action: 'Offer withdrawn', actor: audit.actorFrom(req),
    before: existing, after: { status: 'Withdrawn' }, fields: ['status'], comment: reason || null,
    details: { previousStatus: existing.status, reason: reason || null, promotedApplicationId: result.promoted?.id || null }
  });
  await slaModel.resolveEscalations('OfferApproval', offerId);

  if (existing.status === 'Approved') {
    await safely(`OfferWithdrawn notice for offer ${offerId}`, () => notifyCandidate(existing.application.candidateId, 'OfferWithdrawn',
      `Your offer for "${existing.application.vacancy.title}" has been withdrawn.`
      + (reason ? ` Reason given: ${escapeHtml(reason)}` : '')
      + ' Please contact HR if you have any questions.'));
  }
  broadcastDashboardEvent('OfferWithdrawn', { offerId });
  res.json({ ...(await offerModel.findById(offerId)), promotedApplicationId: result.promoted?.id || null });
}

module.exports = {
  draft, recommend, revise, list, listPendingApproval, approve, returnForRevision, accept, decline, withdraw
};
