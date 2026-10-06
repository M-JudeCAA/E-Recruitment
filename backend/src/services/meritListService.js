const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');

// ===========================================================================
// The post-interview merit list - step three of the selection workflow:
//
//   1. Interview shortlist (applicationController.shortlist / vacancyController
//      .saveRanking, approved by applicationController.approveShortlist) -
//      WHO gets interviewed. No Primary/Reserve any more: before an interview
//      nobody knows who the best candidate is.
//   2. Interviews (interviewController) - each candidate's round is scored by
//      the panel and finalized with a Shortlist / Hold / Reject verdict.
//   3. Merit list (this file) - the interviewed candidates ranked on their
//      results. The top positionsRequired "Shortlist" candidates are Primary
//      (offers are recommended for them); everyone else on the list is
//      Reserve, promoted in merit order when a Primary declines their offer
//      (workflowService.handleOfferDeclined). Proposed by a
//      Senior_HR_Officer+, approved by a Principal_HR_Officer+ who didn't
//      propose it.
//
// A "Hold" verdict means "appointable, but not first choice": such a
// candidate may sit on the list, but only in Reserve and only below every
// candidate the panel recommended outright.
// ===========================================================================

const ELIGIBLE_VERDICTS = ['Shortlist', 'Hold'];
// Offer statuses that mean the merit list has already been acted on. Once
// any application on the vacancy holds one, the list is locked: reserves
// are then managed only by the decline cascade, never by re-ranking under a
// candidate who already has an offer in hand.
const ACTIVE_OFFER_STATUSES = ['Recommended', 'Returned', 'Approved', 'Extended', 'Accepted'];
// Still somewhere in the interview pipeline - shown on the board as "not
// ready yet" so HR can see who the list is waiting on.
const IN_INTERVIEW_STATUSES = ['Shortlisted', 'InterviewScheduled'];

// Every merit-list column reset - an application leaving the list (dropped
// on re-proposal, or rejected outright).
const CLEARED_MERIT = {
  meritRank: null, meritListStatus: null, meritStatus: null,
  meritProposedAt: null, meritProposedById: null, meritApprovedAt: null, meritApprovedById: null
};

const CANDIDATE_SELECT = { id: true, fullName: true, candidateType: true };
const ROUNDS_INCLUDE = { orderBy: { roundNumber: 'asc' } };

// The round that speaks for a candidate: the most recent one that actually
// took place. Cancelled and no-show rounds never happened, so they neither
// count nor cancel an earlier verdict - same rule recommendOffer applies.
function latestHeldRound(rounds = []) {
  return rounds
    .filter((r) => !['Cancelled', 'NoShow'].includes(r.status))
    .sort((a, b) => b.roundNumber - a.roundNumber)[0] || null;
}

// { round, score, recommendation } when the latest held round has a
// finalized, merit-list-worthy verdict; otherwise null.
function interviewOutcome(application) {
  const round = latestHeldRound(application.interviewRounds);
  if (!round || round.score == null || !ELIGIBLE_VERDICTS.includes(round.recommendation)) return null;
  return { round, score: round.score, recommendation: round.recommendation };
}

// Why an application can't go on the merit list, or null if it can.
function ineligibilityReason(application) {
  if (application.status !== 'Interviewed') {
    return `is at status "${application.status}" - only interviewed candidates can be ranked`;
  }
  if (!interviewOutcome(application)) {
    return 'has no finalized "Shortlist" or "Hold" interview verdict';
  }
  return null;
}

// "Shortlist" verdicts first, then by interview score - the default order a
// fresh merit list starts from, and what "Reset to interview scores" restores.
function compareByResult(a, b) {
  const va = a.recommendation === 'Shortlist' ? 0 : 1;
  const vb = b.recommendation === 'Shortlist' ? 0 : 1;
  return va - vb || (b.interviewScore ?? -1) - (a.interviewScore ?? -1);
}

/**
 * Primary/Reserve for an ordered list of verdicts: the first
 * positionsRequired candidates are Primary, provided the panel recommended
 * them outright. Throws when a "Hold" candidate is ranked above a
 * "Shortlist" one. Shared by propose() and (mirrored) the frontend board.
 */
function assignListStatus(orderedVerdicts, positionsRequired) {
  let seenHold = false;
  return orderedVerdicts.map((verdict, i) => {
    if (verdict === 'Hold') seenHold = true;
    else if (seenHold) {
      throw new AppError('A candidate the panel put on "Hold" cannot be ranked above one it recommended ("Shortlist")', 422);
    }
    return i < positionsRequired && verdict === 'Shortlist' ? 'Primary' : 'Reserve';
  });
}

function toRow(app) {
  const outcome = interviewOutcome(app);
  const round = outcome?.round || latestHeldRound(app.interviewRounds);
  return {
    applicationId: app.id,
    candidateId: app.candidate.id,
    candidateName: app.candidate.fullName,
    candidateType: app.candidate.candidateType,
    status: app.status,
    rankVersion: app.rankVersion,
    shortlistScore: app.shortlistScore,
    interviewScore: round?.score ?? null,
    recommendation: round?.recommendation ?? null,
    roundId: round?.id ?? null,
    roundNumber: round?.roundNumber ?? null,
    roundStatus: round?.status ?? null,
    // The panel's signed score sheet, for the reviewer to check the score
    // and verdict against before approving the list.
    scoreSheetUrl: round?.scoreSheetUrl ?? null,
    scoreSheetName: round?.scoreSheetName ?? null,
    meritRank: app.meritRank,
    meritListStatus: app.meritListStatus,
    meritStatus: app.meritStatus,
    offerStatus: app.offer?.status || null,
    offerId: app.offer?.id || null,
    // The whole offer, so the merit list can show its terms and act on it.
    offer: app.offer || null
  };
}

/**
 * Everything the merit list screen needs for one vacancy: the list as it
 * stands, interviewed candidates not (yet) on it, who is still being
 * interviewed, and whether it can still be changed.
 */
async function getBoard(vacancyId) {
  const vacancy = await prisma.vacancy.findUnique({
    where: { id: vacancyId },
    select: { id: true, jobRef: true, title: true, positionsRequired: true, status: true }
  });
  if (!vacancy) throw new AppError('Vacancy not found', 404);

  const applications = await prisma.application.findMany({
    where: { vacancyId, status: { in: [...IN_INTERVIEW_STATUSES, 'Interviewed', 'Offered'] } },
    include: {
      candidate: { select: CANDIDATE_SELECT },
      interviewRounds: ROUNDS_INCLUDE,
      offer: { include: { recommendedBy: { select: { name: true } }, returnedBy: { select: { name: true } } } },
      meritProposedBy: { select: { id: true, name: true } },
      meritApprovedBy: { select: { id: true, name: true } }
    }
  });

  const onList = applications.filter((a) => a.meritStatus != null).sort((a, b) => a.meritRank - b.meritRank);
  const entries = onList.map(toRow);
  const eligible = applications
    .filter((a) => a.meritStatus == null && !ineligibilityReason(a))
    .map(toRow)
    .sort(compareByResult);
  const awaiting = applications
    .filter((a) => a.meritStatus == null && (IN_INTERVIEW_STATUSES.includes(a.status)
      || (a.status === 'Interviewed' && !interviewOutcome(a))))
    .map(toRow);

  const proposed = onList.filter((a) => a.meritStatus === 'Proposed');
  const state = proposed.length > 0 ? 'Proposed' : onList.length > 0 ? 'Approved' : 'NotStarted';
  const latest = (rows, at) => rows.reduce((best, a) => (!best || (a[at] && a[at] > best[at]) ? a : best), null);
  const lastProposal = latest(onList, 'meritProposedAt');
  const lastApproval = latest(onList.filter((a) => a.meritStatus === 'Approved'), 'meritApprovedAt');
  const locked = applications.some((a) => a.offer && ACTIVE_OFFER_STATUSES.includes(a.offer.status));

  return {
    vacancy,
    state,
    locked,
    proposedBy: lastProposal?.meritProposedBy ? { ...lastProposal.meritProposedBy, at: lastProposal.meritProposedAt } : null,
    approvedBy: state === 'Approved' && lastApproval?.meritApprovedBy
      ? { ...lastApproval.meritApprovedBy, at: lastApproval.meritApprovedAt } : null,
    entries,
    eligible,
    awaiting,
    suggestedOrder: [...entries.filter((e) => e.status === 'Interviewed'), ...eligible]
      .sort(compareByResult).map((r) => r.applicationId)
  };
}

/**
 * Proposes (or re-proposes) the vacancy's merit list: applicationIds in
 * merit order, applicationRankVersions the rankVersion the client saw for
 * each. Candidates dropped from a previous list come off it. Everything is
 * written in one transaction; the list needs a fresh approval afterwards.
 */
async function propose(vacancyId, applicationIds, applicationRankVersions, proposedById) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  if (!vacancy) throw new AppError('Vacancy not found', 404);

  const all = await prisma.application.findMany({
    where: { vacancyId },
    include: { candidate: { select: CANDIDATE_SELECT }, interviewRounds: { orderBy: { roundNumber: 'asc' } }, offer: true }
  });
  if (all.some((a) => a.offer && ACTIVE_OFFER_STATUSES.includes(a.offer.status))) {
    throw new AppError('Offers have already been made from this merit list, so it can no longer be re-ranked. A declined offer moves the next reserve up automatically.', 409);
  }

  const byId = new Map(all.map((a) => [a.id, a]));
  const listed = applicationIds.map((id) => byId.get(id));
  if (listed.some((a) => !a)) throw new AppError('One or more application ids do not belong to this vacancy', 400);
  // Same optimistic-concurrency rule as the interview shortlist
  // (vacancyController.saveRanking): anything written since this client
  // loaded the board rejects the whole list rather than overwriting it.
  // Everyone on the current list who isn't on the new one comes off it -
  // including a candidate whose offer was declined or withdrawn (an offer
  // still in play would have locked the list above).
  const previous = all.filter((a) => a.meritStatus != null && !applicationIds.includes(a.id));
  for (const a of [...listed, ...previous]) {
    if (applicationRankVersions[a.id] !== undefined && applicationRankVersions[a.id] !== a.rankVersion) {
      throw new AppError('The merit list has changed since you loaded it - please refresh and try again', 409);
    }
  }
  if (listed.some((a) => applicationRankVersions[a.id] === undefined)) {
    throw new AppError('applicationRankVersions must include an integer rankVersion for every application id', 400);
  }
  for (const a of listed) {
    const reason = ineligibilityReason(a);
    if (reason) throw new AppError(`${a.candidate.fullName} ${reason}`, 422);
  }

  const statuses = assignListStatus(listed.map((a) => interviewOutcome(a).recommendation), vacancy.positionsRequired);
  const now = new Date();
  await prisma.$transaction([
    ...listed.map((a, i) => prisma.application.update({
      where: { id: a.id },
      data: {
        meritRank: i + 1, meritListStatus: statuses[i], meritStatus: 'Proposed',
        meritProposedAt: now, meritProposedById: proposedById,
        meritApprovedAt: null, meritApprovedById: null,
        rankVersion: { increment: 1 }
      }
    })),
    ...previous.map((a) => prisma.application.update({
      where: { id: a.id },
      data: { ...CLEARED_MERIT, rankVersion: { increment: 1 } }
    }))
  ]);

  return {
    vacancy,
    primaryCount: statuses.filter((s) => s === 'Primary').length,
    reserveCount: statuses.filter((s) => s === 'Reserve').length
  };
}

/**
 * Approves the proposed merit list as one decision. Blocked for anyone who
 * proposed any of it - the same self-approval rule as the shortlist
 * (workflowService.assertNotSelfApprovedShortlist).
 */
async function approve(vacancyId, approverId) {
  const proposed = await prisma.application.findMany({
    where: { vacancyId, meritStatus: 'Proposed' },
    select: { id: true, meritProposedById: true, meritListStatus: true }
  });
  if (proposed.length === 0) throw new AppError('No proposed merit list is awaiting approval for this vacancy', 422);
  if (proposed.some((a) => a.meritProposedById === approverId)) {
    throw new AppError('You proposed this merit list, so it must be approved by another Principal HR Officer or above', 422);
  }
  const result = await prisma.application.updateMany({
    where: { vacancyId, meritStatus: 'Proposed' },
    data: { meritStatus: 'Approved', meritApprovedAt: new Date(), meritApprovedById: approverId }
  });
  return {
    approvedCount: result.count,
    primaryCount: proposed.filter((a) => a.meritListStatus === 'Primary').length
  };
}

// Approvals Center: one row per vacancy with a merit list awaiting approval.
async function listPendingApproval() {
  const rows = await prisma.application.findMany({
    where: { meritStatus: 'Proposed' },
    select: {
      vacancyId: true, meritListStatus: true, meritProposedAt: true,
      meritProposedBy: { select: { id: true, name: true } },
      vacancy: { select: { id: true, jobRef: true, title: true, positionsRequired: true } }
    }
  });
  const byVacancy = new Map();
  for (const r of rows) {
    const entry = byVacancy.get(r.vacancyId) || {
      vacancy: r.vacancy, candidates: 0, primary: 0, proposedAt: null, proposedBy: null
    };
    entry.candidates += 1;
    if (r.meritListStatus === 'Primary') entry.primary += 1;
    if (!entry.proposedAt || r.meritProposedAt > entry.proposedAt) {
      entry.proposedAt = r.meritProposedAt;
      entry.proposedBy = r.meritProposedBy;
    }
    byVacancy.set(r.vacancyId, entry);
  }
  return [...byVacancy.values()].sort((a, b) => a.proposedAt - b.proposedAt);
}

module.exports = {
  ELIGIBLE_VERDICTS, ACTIVE_OFFER_STATUSES, CLEARED_MERIT,
  latestHeldRound, interviewOutcome, ineligibilityReason, assignListStatus,
  getBoard, propose, approve, listPendingApproval
};
