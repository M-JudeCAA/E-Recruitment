const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');
const meritList = require('./meritListService');
const { notifyAllWithRole } = require('./notificationService');

// ===========================================================================
// Offer management - step four of selection, fed by the merit list:
//
//   merit list approved -> Primary candidate
//     -> Recommended   Principal HR Officer+ drafts the offer: salary, start
//                      date, contract, duty station, conditions, and how long
//                      the candidate has to answer.
//     -> Returned      a Manager/Director sends it back with a reason; the
//                      Principal HR Officer revises and resubmits it.
//     -> Approved      a Manager/Director who didn't recommend it approves;
//                      the offer is issued to the candidate and the response
//                      deadline fixed.
//     -> Accepted | Declined | Expired (deadline passed) | Withdrawn
//
// Declined, Expired and Withdrawn release the position: the next reserve on
// the merit list moves up to Primary (workflowService.closeOffer).
// ===========================================================================

const EMPLOYMENT_CATEGORIES = ['FullTime', 'Contract', 'FixedTermContract'];
const SALARY_PERIODS = ['Monthly', 'Annual'];
const MIN_RESPONSE_DAYS = 3;
const MAX_RESPONSE_DAYS = 30;
const DEFAULT_RESPONSE_DAYS = 14;
const MAX_CONDITIONS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
// Offers still waiting on someone - HR, an approver or the candidate.
const OPEN_STATUSES = ['Recommended', 'Returned', 'Approved'];
// Suggested pre-employment conditions for a new draft - HR edits freely.
const DEFAULT_CONDITIONS = [
  'Satisfactory references from the referees named on your application',
  'Verification of your academic and professional certificates',
  'A certificate of medical fitness'
];

function cleanText(value, max) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new AppError('Expected text', 400);
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Validates the terms of an offer as sent by the client and returns the
 * columns to store. Everything a candidate needs to decide is required;
 * allowances, duty station and conditions are optional.
 */
function parseTerms(body = {}, now = new Date()) {
  const salaryAmount = Number(body.salaryAmount);
  if (!Number.isFinite(salaryAmount) || salaryAmount <= 0 || salaryAmount >= 1e12) {
    throw new AppError('Enter the salary being offered', 400);
  }
  const salaryCurrency = body.salaryCurrency == null || body.salaryCurrency === '' ? 'UGX' : String(body.salaryCurrency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(salaryCurrency)) throw new AppError('Currency must be a three-letter code such as UGX', 400);
  const salaryPeriod = body.salaryPeriod || 'Monthly';
  if (!SALARY_PERIODS.includes(salaryPeriod)) throw new AppError(`Salary period must be one of ${SALARY_PERIODS.join(', ')}`, 400);

  const employmentCategory = body.employmentCategory;
  if (!EMPLOYMENT_CATEGORIES.includes(employmentCategory)) throw new AppError('Choose the employment category', 400);
  let contractMonths = null;
  if (employmentCategory !== 'FullTime') {
    contractMonths = Number(body.contractMonths);
    if (!Number.isInteger(contractMonths) || contractMonths < 1 || contractMonths > 120) {
      throw new AppError('Enter the contract length in months (1-120)', 400);
    }
  }

  const startDate = body.startDate ? new Date(body.startDate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) throw new AppError('Enter the start date', 400);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (startDate < today) throw new AppError('The start date cannot be in the past', 400);

  const responseDays = body.responseDays == null || body.responseDays === '' ? DEFAULT_RESPONSE_DAYS : Number(body.responseDays);
  if (!Number.isInteger(responseDays) || responseDays < MIN_RESPONSE_DAYS || responseDays > MAX_RESPONSE_DAYS) {
    throw new AppError(`The candidate must have between ${MIN_RESPONSE_DAYS} and ${MAX_RESPONSE_DAYS} days to respond`, 400);
  }

  let conditions = [];
  if (body.conditions != null) {
    if (!Array.isArray(body.conditions)) throw new AppError('conditions must be a list', 400);
    conditions = body.conditions.map((c) => cleanText(c, 300)).filter(Boolean);
    if (conditions.length > MAX_CONDITIONS) throw new AppError(`An offer can list at most ${MAX_CONDITIONS} conditions`, 400);
  }

  return {
    salaryAmount, salaryCurrency, salaryPeriod,
    allowances: cleanText(body.allowances, 2000),
    employmentCategory, contractMonths, startDate,
    dutyStation: cleanText(body.dutyStation, 191),
    conditions, responseDays
  };
}

// The columns parseTerms sets - what an offer's terms are, for the audit trail.
const TERM_FIELDS = ['salaryAmount', 'salaryCurrency', 'salaryPeriod', 'allowances', 'employmentCategory',
  'contractMonths', 'startDate', 'dutyStation', 'conditions', 'responseDays'];

function termsOf(offer) {
  return Object.fromEntries(TERM_FIELDS.map((f) => [f, offer[f] ?? null]));
}

// An offer drafted before terms existed can't be issued as it stands.
function hasTerms(offer) {
  return offer.salaryAmount != null && offer.startDate != null && offer.employmentCategory != null;
}

// Why an offer can't be recommended for this application, or null.
function recommendBlocker(application) {
  if (application.status !== 'Interviewed') return 'This application is not awaiting an offer recommendation';
  // The latest round that actually took place must still carry a verdict
  // the merit list accepts - a later "Reject" outranks an earlier pass.
  // "Hold" is allowed: such a candidate only reaches Primary by promotion.
  if (!meritList.interviewOutcome(application)) return 'This application has no finalized "Shortlist" or "Hold" interview verdict';
  if (application.meritStatus !== 'Approved') {
    return 'This candidate is not on an approved merit list yet - rank the interviewed candidates and have the merit list approved first';
  }
  if (application.meritListStatus !== 'Primary') return 'This candidate is on the reserve list - offers are recommended for Primary candidates only';
  return null;
}

const DRAFT_INCLUDE = {
  candidate: { select: { id: true, fullName: true, candidateType: true } },
  vacancy: {
    select: {
      id: true, jobRef: true, title: true, salaryScale: true, employmentCategory: true, positionsRequired: true,
      department: { select: { name: true, directorate: { select: { name: true } } } }
    }
  },
  interviewRounds: true,
  offer: { include: { returnedBy: { select: { name: true } } } }
};

/**
 * What the offer form needs: who the candidate is and where they stand, the
 * vacancy's advertised terms to start from, and any existing offer (for a
 * revision). canRecommend/blocker say whether a new offer is allowed.
 */
async function draftContext(applicationId, now = new Date()) {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: DRAFT_INCLUDE });
  if (!application) throw new AppError('Application not found', 404);
  const outcome = meritList.interviewOutcome(application);
  const { vacancy } = application;
  const start = new Date(now.getTime() + 30 * DAY_MS);
  return {
    application: { id: application.id, status: application.status },
    candidate: application.candidate,
    vacancy: { ...vacancy, department: undefined, departmentName: vacancy.department?.name || null },
    merit: {
      rank: application.meritRank, listStatus: application.meritListStatus, status: application.meritStatus,
      interviewScore: outcome?.score ?? null, recommendation: outcome?.recommendation ?? null
    },
    offer: application.offer,
    blocker: application.offer ? null : recommendBlocker(application),
    suggested: {
      salaryCurrency: 'UGX',
      salaryPeriod: 'Monthly',
      employmentCategory: vacancy.employmentCategory || 'FullTime',
      contractMonths: vacancy.employmentCategory && vacancy.employmentCategory !== 'FullTime' ? 24 : null,
      startDate: start.toISOString().slice(0, 10),
      dutyStation: vacancy.department?.name || null,
      conditions: application.candidate.candidateType === 'Internal'
        ? [...DEFAULT_CONDITIONS.slice(1), 'Release from your current UCAA post on the start date']
        : DEFAULT_CONDITIONS,
      responseDays: DEFAULT_RESPONSE_DAYS
    }
  };
}

/** Principal HR Officer+ recommends an offer, with its terms. */
async function recommend(applicationId, body, recommendedById) {
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { interviewRounds: true } });
  if (!application) throw new AppError('Application not found', 404);
  const blocker = recommendBlocker(application);
  if (blocker) throw new AppError(blocker, 422);
  const terms = parseTerms(body);

  let offer;
  try {
    offer = await prisma.offer.create({
      data: {
        applicationId,
        status: 'Recommended',
        recommendedById,
        recommendedDate: new Date(), // SLA timing - see checkSlaEscalations.js
        ...terms,
        meritRankAtOffer: application.meritRank ?? null,
        interviewScoreAtOffer: meritList.interviewOutcome(application)?.score ?? null
      }
    });
  } catch (err) {
    // Offer.applicationId is unique - a second recommendation hits this.
    throw new AppError('An offer has already been recommended for this application', 409);
  }
  await prisma.application.update({ where: { id: applicationId }, data: { status: 'Offered' } });
  return offer;
}

/**
 * Revises a Recommended or Returned offer's terms and (re)submits it for
 * approval. Whoever revises becomes the recommender, so the self-approval
 * block follows the person who last set the terms.
 */
async function revise(offerId, body, revisedById) {
  const existing = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!existing) throw new AppError('Offer not found', 404);
  if (!['Recommended', 'Returned'].includes(existing.status)) {
    throw new AppError(`An offer at status "${existing.status}" can no longer be revised`, 422);
  }
  const terms = parseTerms(body);
  const result = await prisma.offer.updateMany({
    where: { id: offerId, status: existing.status },
    data: { ...terms, status: 'Recommended', recommendedById: revisedById, recommendedDate: new Date() }
  });
  if (result.count === 0) throw new AppError('This offer was already updated - please refresh and try again', 409);
  return { previousStatus: existing.status, before: existing, offer: await prisma.offer.findUnique({ where: { id: offerId } }) };
}

/**
 * The approver issues the offer: status Approved and the response deadline
 * fixed from responseDays. Refused when the terms are missing (an offer
 * recommended before terms existed) or every position is already filled.
 */
async function approve(offer, approverId, now = new Date()) {
  if (!hasTerms(offer)) {
    throw new AppError('This offer has no terms yet - the recommending officer needs to add the salary, start date and contract before it can be approved', 422);
  }
  const vacancy = offer.application.vacancy;
  const accepted = await prisma.offer.count({ where: { status: 'Accepted', application: { vacancyId: vacancy.id } } });
  if (accepted >= vacancy.positionsRequired) {
    throw new AppError('Every position on this vacancy is already filled - withdraw this offer, or raise the number of positions first', 409);
  }
  const responseDeadline = new Date(now.getTime() + (offer.responseDays || DEFAULT_RESPONSE_DAYS) * DAY_MS);
  const result = await prisma.offer.updateMany({
    where: { id: offer.id, status: 'Recommended' },
    data: { status: 'Approved', approvedById: approverId, approvedDate: now, responseDeadline }
  });
  if (result.count === 0) throw new AppError('This offer was already updated - please refresh and try again', 409);
  return responseDeadline;
}

/** The approver sends a Recommended offer back for revision. */
async function returnForRevision(offerId, reason, returnedById) {
  const text = cleanText(reason, 1000);
  if (!text || text.length < 3) throw new AppError('Say what needs to change before the offer can be approved', 400);
  const result = await prisma.offer.updateMany({
    where: { id: offerId, status: 'Recommended' },
    data: { status: 'Returned', returnedAt: new Date(), returnedById, returnReason: text }
  });
  if (result.count === 0) throw new AppError('Only an offer awaiting approval can be returned', 409);
  return text;
}

// Issued offers whose deadline is near (reminder) or past (expiry) - for
// scripts/expireOffers.js.
function findDueForReminder(now, withinMs) {
  return prisma.offer.findMany({
    where: { status: 'Approved', responseReminderSentAt: null, responseDeadline: { gt: now, lte: new Date(now.getTime() + withinMs) } },
    include: { application: { include: { vacancy: true, candidate: { select: { fullName: true } } } } }
  });
}
function findOverdue(now) {
  return prisma.offer.findMany({
    where: { status: 'Approved', responseDeadline: { lte: now } },
    include: { application: { include: { vacancy: true, candidate: { select: { fullName: true } } } } }
  });
}

const LIST_INCLUDE = {
  recommendedBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  returnedBy: { select: { name: true } },
  withdrawnBy: { select: { name: true } },
  application: {
    select: {
      id: true, status: true, meritRank: true, meritListStatus: true,
      candidate: { select: { id: true, fullName: true, candidateType: true } },
      vacancy: { select: { id: true, jobRef: true, title: true, positionsRequired: true, status: true } }
    }
  }
};
const EXPIRING_WITHIN_MS = 3 * DAY_MS;

/**
 * The cross-vacancy offer tracker: a page of offers (filtered by status,
 * vacancy or "expiring soon"), plus a count per status for the whole set.
 */
async function list({ status, vacancyId, expiringSoon, skip, take }, now = new Date()) {
  const where = {};
  if (status) where.status = status;
  if (vacancyId) where.application = { vacancyId };
  if (expiringSoon) {
    where.status = 'Approved';
    where.responseDeadline = { gt: now, lte: new Date(now.getTime() + EXPIRING_WITHIN_MS) };
  }
  const [data, total, grouped, expiring] = await Promise.all([
    prisma.offer.findMany({ where, include: LIST_INCLUDE, orderBy: [{ id: 'desc' }], skip, take }),
    prisma.offer.count({ where }),
    prisma.offer.groupBy({ by: ['status'], _count: { _all: true }, ...(vacancyId ? { where: { application: { vacancyId } } } : {}) }),
    prisma.offer.count({
      where: {
        status: 'Approved', responseDeadline: { gt: now, lte: new Date(now.getTime() + EXPIRING_WITHIN_MS) },
        ...(vacancyId ? { application: { vacancyId } } : {})
      }
    })
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return { data, total, counts, expiringSoon: expiring };
}

/**
 * What a candidate may see of their own offer. Nothing at all until it is
 * issued (approved) - a recommendation still awaiting approval, or one sent
 * back for revision, is HR's business. Who recommended/approved it, the
 * merit snapshot and any return reason stay staff-only.
 */
function toCandidateOffer(offer) {
  if (!offer || !offer.approvedDate) return null;
  return {
    id: offer.id,
    status: offer.status === 'Extended' ? 'Approved' : offer.status,
    issuedAt: offer.approvedDate,
    responseDeadline: offer.responseDeadline,
    salaryAmount: offer.salaryAmount,
    salaryCurrency: offer.salaryCurrency,
    salaryPeriod: offer.salaryPeriod,
    allowances: offer.allowances,
    employmentCategory: offer.employmentCategory,
    contractMonths: offer.contractMonths,
    startDate: offer.startDate,
    dutyStation: offer.dutyStation,
    conditions: offer.conditions || [],
    decidedAt: offer.decidedAt,
    declineReason: offer.declineReason,
    withdrawalReason: offer.status === 'Withdrawn' ? offer.withdrawalReason : null
  };
}

// "UGX 4,500,000 per month" - for notification text.
function describeSalary(offer) {
  if (offer.salaryAmount == null) return null;
  const amount = Number(offer.salaryAmount).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${offer.salaryCurrency || 'UGX'} ${amount}${offer.salaryPeriod === 'Annual' ? ' per year' : ' per month'}`;
}

// Tells Principal HR Officers an offer closed without a hire (declined,
// expired or withdrawn) and who, if anyone, moved up from the reserve list
// to take the position. `what` is already HTML-safe. Never throws - the
// close has already committed.
async function notifyPositionReleased(taskType, offerId, vacancy, applicationId, what, promoted) {
  const where = vacancy ? `${vacancy.jobRef} (${vacancy.title})` : 'a vacancy';
  try {
    await notifyAllWithRole('Principal_HR_Officer', taskType, offerId,
      `An offer for ${where} ${what} (application #${applicationId}). `
      + (promoted
        ? `The next reserve candidate (application #${promoted.id}) has been moved to Primary - recommend an offer for them when ready.`
        : 'There are no reserve candidates left on this vacancy\'s merit list.'));
  } catch (err) {
    console.error(`Failed to send ${taskType} notification for ${where}:`, err);
  }
}

module.exports = {
  EMPLOYMENT_CATEGORIES, SALARY_PERIODS, MIN_RESPONSE_DAYS, MAX_RESPONSE_DAYS, DEFAULT_RESPONSE_DAYS, OPEN_STATUSES, DEFAULT_CONDITIONS,
  TERM_FIELDS, termsOf, parseTerms, hasTerms, recommendBlocker, draftContext, recommend, revise, approve, returnForRevision,
  findDueForReminder, findOverdue, list, toCandidateOffer, describeSalary, notifyPositionReleased
};
