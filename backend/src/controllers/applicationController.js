const applicationModel = require('../models/applicationModel');
const offerModel = require('../models/offerModel');
const slaModel = require('../models/slaModel');
const workflow = require('../services/workflowService');
const { notifyCandidate } = require('../services/candidateNotificationService');

// NOTE: application creation/submission lives in applicationDraftController
// now (saveDraft/submit/withdraw) - see routes/applications.js. This file
// keeps everything downstream of a Submitted application.

// Cross-vacancy total for HRHome's KPI card - one count query instead of
// fetching every vacancy's application list and summing client-side.
async function count(req, res) {
  const total = await applicationModel.countAll();
  res.json({ count: total });
}

const VALID_STATUSES = [
  'Submitted', 'UnderReview', 'Shortlisted', 'InterviewScheduled',
  'Interviewed', 'Offered', 'Rejected', 'Withdrawn'
]; // ApplicationStatus minus Draft - HR has no business filtering to drafts
const VALID_CANDIDATE_TYPES = ['Internal', 'External'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// The Application Management queue - a real cross-vacancy list backed by
// server-side filtering/pagination, replacing the old client-side N+1
// (fetch every vacancy's applications, flatten) HRDashboard.jsx used to do.
async function list(req, res) {
  const { vacancyId, status, departmentId, candidateType, screeningPassed, search, page, limit } = req.query;
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status filter' });
  }
  if (candidateType && !VALID_CANDIDATE_TYPES.includes(candidateType)) {
    return res.status(400).json({ error: 'Invalid candidateType filter' });
  }
  // Number(vacancyId) on a garbage query param (e.g. ?vacancyId=abc) is NaN,
  // which Prisma would otherwise reject with a raw 500 - caught here instead.
  if (vacancyId !== undefined && !Number.isInteger(Number(vacancyId))) {
    return res.status(400).json({ error: 'Invalid vacancyId filter' });
  }
  if (departmentId !== undefined && !Number.isInteger(Number(departmentId))) {
    return res.status(400).json({ error: 'Invalid departmentId filter' });
  }

  const filters = {
    vacancyId: vacancyId ? Number(vacancyId) : undefined,
    status: status || undefined,
    departmentId: departmentId ? Number(departmentId) : undefined,
    candidateType: candidateType || undefined,
    screeningPassed: screeningPassed === 'true' ? true : screeningPassed === 'false' ? false : undefined,
    search: search?.trim() || undefined
  };
  const take = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;

  const [data, total] = await Promise.all([
    applicationModel.findManyForHr({ ...filters, skip, take }),
    applicationModel.countForHr(filters)
  ]);
  res.json({ data, total, page: pageNum, limit: take });
}

// Same terminal/out-of-reach statuses reject() already refuses, plus the
// same reasoning: a Draft/Offered/Rejected/Withdrawn application has no
// business being (re)shortlisted here.
const NOT_SHORTLISTABLE = ['Draft', 'Offered', 'Rejected', 'Withdrawn'];
const VALID_LIST_STATUSES = ['Primary', 'Reserve'];

async function shortlist(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });

  const { rank, listStatus } = req.body;
  if (rank !== undefined && rank !== null && !(Number.isInteger(rank) && rank > 0)) {
    return res.status(400).json({ error: 'rank must be a positive integer' });
  }
  if (listStatus !== undefined && listStatus !== null && !VALID_LIST_STATUSES.includes(listStatus)) {
    return res.status(400).json({ error: `listStatus must be one of: ${VALID_LIST_STATUSES.join(', ')}` });
  }

  try {
    await workflow.assertCanShortlist(applicationId);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const application = await applicationModel.findById(applicationId, { vacancy: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (NOT_SHORTLISTABLE.includes(application.status)) {
    return res.status(422).json({ error: `An application at status "${application.status}" cannot be shortlisted here` });
  }

  // Same atomic-guard pattern as reject() - scoped to the status just read,
  // so a near-simultaneous action on this application (e.g. a reject
  // landing at the same moment) can't silently be overwritten by this one.
  const result = await applicationModel.updateIfStatus(applicationId, application.status, {
    status: 'Shortlisted', rank, listStatus, rankVersion: { increment: 1 }
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This application was already updated - please refresh and try again' });
  }

  try {
    await notifyCandidate(
      application.candidateId, 'ApplicationShortlisted',
      `Good news - you've been shortlisted for "${application.vacancy.title}". We'll be in touch about next steps.`
    );
  } catch (err) {
    console.error(`Failed to notify candidate ${application.candidateId} of shortlisting for application ${applicationId}:`, err);
  }
  const updated = await applicationModel.findById(applicationId, { vacancy: true });
  res.json(updated);
}

// A status HR can reach from anywhere before an offer is on the table -
// Submitted through Interviewed. Not Draft (the candidate's own to
// withdraw, HR never sees it), not Offered/Rejected/Withdrawn (already
// terminal or past the point rejection makes sense here). Gated at the
// same Senior_HR_Officer+ tier as shortlist/beginReview - the first tier
// with review authority over an application.
const NOT_REJECTABLE = ['Draft', 'Offered', 'Rejected', 'Withdrawn'];

async function reject(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
  const application = await applicationModel.findById(applicationId, { vacancy: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (NOT_REJECTABLE.includes(application.status)) {
    return res.status(422).json({ error: `An application at status "${application.status}" cannot be rejected here` });
  }

  const reason = req.body.reason || null;
  // Scoped to the status just read, same atomic-guard pattern as
  // applicationModel.updateIfStatus's other callers - avoids a second,
  // near-simultaneous action on this application (an interview panel's
  // "Reject" recommendation landing at the same moment as this) silently
  // overwriting each other.
  const result = await applicationModel.updateIfStatus(applicationId, application.status, {
    status: 'Rejected', rejectedAt: new Date(), rejectedById: req.user.id, rejectionReason: reason
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This application was already updated - please refresh and try again' });
  }

  // The rejection itself already committed above - a notification/mail
  // failure here must not turn an otherwise-successful reject into a 500
  // (which would also make the frontend show an error for an action that
  // actually succeeded, and any retry would then hit the 409 above).
  try {
    await notifyCandidate(
      application.candidateId, 'ApplicationRejected',
      `We're sorry to let you know your application for "${application.vacancy.title}" was not successful this time.` +
        (reason ? ` ${reason}` : '')
    );
  } catch (err) {
    console.error(`Failed to notify candidate ${application.candidateId} of rejection for application ${applicationId}:`, err);
  }

  const updated = await applicationModel.findById(applicationId, { vacancy: true, rejectedBy: { select: { name: true } } });
  res.json(updated);
}

// NOT a second approval gate on top of shortlist()/saveRanking() - this is
// only ever the self-approval pre-check, kept as its own endpoint so a
// caller can find out *before* attempting to shortlist whether they're
// blocked from doing so on this vacancy (they created it). Shortlisting
// itself still has to happen via shortlist() or vacancyController.saveRanking.
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
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });

  const application = await applicationModel.findById(applicationId, { interviewRounds: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });

  // Requires both an application actually at Interviewed (not, say,
  // already Rejected by a "Reject" panel recommendation - see
  // interviewController.finalizeRecommendation) AND a round whose
  // recommendation is specifically "Shortlist", not merely present.
  // Previously only "some round has any recommendation at all" was
  // checked, so a panel's explicit "Hold" or "Reject" recommendation
  // satisfied this exactly like "Shortlist" would - letting PHRO
  // recommend an offer for someone the panel had said not to hire.
  if (application.status !== 'Interviewed') {
    return res.status(422).json({ error: 'This application is not awaiting an offer recommendation' });
  }
  // Looks at the MOST RECENT round specifically, not "any round ever said
  // Shortlist" - a candidate with multiple rounds where an earlier round
  // said Shortlist but a later, more authoritative round said Hold/Reject
  // must not still qualify just because some earlier round once passed.
  const mostRecentRound = [...application.interviewRounds].sort((a, b) => b.roundNumber - a.roundNumber)[0];
  if (!mostRecentRound || mostRecentRound.score == null || mostRecentRound.recommendation !== 'Shortlist') {
    return res.status(422).json({ error: 'This application has no finalized "Shortlist" interview recommendation yet' });
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

// Manager/Director Approvals Center - every offer currently awaiting
// their approval, across every vacancy, in one list instead of hunting
// through each vacancy's own applications tab. Paginated the same way the
// cross-vacancy application queue (list, above) is.
async function listOffersPendingApproval(req, res) {
  const { page, limit } = req.query;
  const take = Math.min(Number(limit) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * take;

  const [data, total] = await Promise.all([
    offerModel.findManyPendingApproval({ skip, take }),
    offerModel.countPendingApproval()
  ]);
  res.json({ data, total, page: pageNum, limit: take });
}

async function approveOffer(req, res) {
  const offerId = Number(req.params.offerId);
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (existing.status !== 'Recommended') {
    return res.status(422).json({ error: `An offer at status "${existing.status}" cannot be approved` });
  }

  // Atomic guard - scoped to the status just read, so a second concurrent
  // approve (double-click, or two Managers racing) can't both succeed and
  // both re-stamp approvedById/approvedDate and re-fire the candidate email.
  const result = await offerModel.updateIfStatus(offerId, 'Recommended', {
    status: 'Approved', approvedById: req.user.id, approvedDate: new Date()
  });
  if (result.count === 0) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }
  const offer = await offerModel.findById(offerId);
  // The spec defines slaModel.resolveEscalations but never calls it
  // anywhere - without this, an escalated OfferApproval task would stay
  // "active" (resolvedAt: null) forever even after being decided.
  await slaModel.resolveEscalations('OfferApproval', offerId);
  // Approved (not Recommended) is the moment the candidate can actually
  // act on this - OfferPanel in CandidateApplications.jsx only renders
  // Accept/Decline once offer.status === 'Approved'. Notifying any
  // earlier would point the candidate at something they can't do
  // anything about yet.
  if (offer.application?.vacancy) {
    await notifyCandidate(
      offer.application.candidateId, 'OfferReceived',
      `Congratulations! You have received an offer for "${offer.application.vacancy.title}". Please log in to accept or decline.`
    );
  }
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
  if (existing.status !== 'Approved') {
    return res.status(422).json({ error: `An offer at status "${existing.status}" cannot be accepted` });
  }

  const result = await workflow.acceptOfferTransactionally(offerId);
  if (result.conflict) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }
  const offer = result.offer;

  // A snapshot-audit failure here must not turn an already-successful
  // accept into a 500 - the accept (and vacancy status recompute) already
  // committed atomically above.
  try {
    await workflow.captureSnapshot({
      entityType: 'HireSnapshot',
      entityId: offer.id,
      candidateId: offer.application.candidateId,
      performedById: offer.approvedById
    });
  } catch (err) {
    console.error(`Failed to capture hire snapshot for offer ${offerId}:`, err);
  }
  res.json(offer);
}

async function declineOffer(req, res) {
  const offerId = Number(req.params.offerId);
  const existing = await offerModel.findById(offerId);
  if (!existing) return res.status(404).json({ error: 'Offer not found' });
  if (existing.application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your offer' });
  }
  if (existing.status !== 'Approved') {
    return res.status(422).json({ error: `An offer at status "${existing.status}" cannot be declined` });
  }

  const result = await workflow.handleOfferDeclined(offerId);
  if (result.conflict) {
    return res.status(409).json({ error: 'This offer was already updated - please refresh and try again' });
  }
  res.json(result);
}

module.exports = {
  count, list, shortlist, reject, approveShortlist, recommendOffer,
  listOffersPendingApproval, approveOffer, acceptOffer, declineOffer
};
