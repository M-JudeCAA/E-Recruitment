const prisma = require('../config/db');

// Mirrors applicationController.NOT_SHORTLISTABLE - kept here too (not
// imported from a controller, which services never depend on) since this
// is the one check both shortlist() and saveRanking() need. Before this,
// only shortlist() enforced it directly; saveRanking() had no status gate
// at all and could silently write a Draft/Offered/Rejected/Withdrawn
// application straight back to ShortlistProposed - most easily triggered
// by a stale ranking UI still holding a since-rejected candidate's id
// (see ApplicationManagement.jsx's alreadyRanked, which is status-agnostic).
const NOT_SHORTLISTABLE = ['Draft', 'Offered', 'Rejected', 'Withdrawn'];

/**
 * Mandatory internal-candidate verification gate, plus a status gate every
 * shortlisting entry point (single shortlist() and bulk saveRanking()) now
 * shares. Blocks Application -> Shortlisted unless HR has verified
 * employment with either comments or an appointment letter on
 * file. Applies regardless of vacancy posting_type or department match.
 */
async function assertCanShortlist(applicationId) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { candidate: { include: { internalProfile: true } } }
  });
  if (!application) throw new Error('Application not found');

  if (NOT_SHORTLISTABLE.includes(application.status)) {
    throw new Error(`An application at status "${application.status}" cannot be shortlisted here`);
  }

  if (application.candidate.candidateType === 'Internal') {
    const profile = application.candidate.internalProfile;
    if (!profile || profile.verificationStatus !== 'HR_Verified') {
      throw new Error('Internal candidate employment must be HR Verified before shortlisting');
    }
    if (!profile.verificationEvidenceType) {
      throw new Error('Verification requires comments or an appointment letter');
    }
  }
}

/**
 * Self-approval block: a Principal HR Officer (or above) cannot approve
 * a vacancy or shortlist they personally created/acted on - must route up.
 */
// Everyone a request acts for: the staff member, and - when a delegation is
// what let them through the gate - the delegator whose authority they are
// using. An approval given with someone's authority counts as theirs, so a
// delegate can't approve what their delegator created, proposed or
// recommended. Each assertNotSelf* below takes this list (or one id).
function actingIds(req) {
  return [req.user?.id, req.actingAsDelegateFor].filter((id) => id != null);
}

const idsOf = (approver) => (Array.isArray(approver) ? approver : [approver]).filter((id) => id != null);
const FOR_DELEGATOR = 'Self-approval blocked: you are acting under a delegation from the person who';

async function assertNotSelfApproval(vacancyId, approver) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId } });
  const [own, ...actingFor] = idsOf(approver);
  if (vacancy && vacancy.createdById === own) {
    throw new Error('Self-approval blocked: route this approval to DHRA / Manager HR instead');
  }
  if (vacancy && actingFor.includes(vacancy.createdById)) {
    throw new Error(`${FOR_DELEGATOR} created this vacancy - someone else must approve it`);
  }
}

/**
 * Self-approval block for the shortlist propose/approve split: whoever
 * ran shortlist()/saveRanking for an application (shortlistProposedById)
 * cannot also be the one who approves that vacancy's proposed shortlist -
 * must route to a different Principal HR Officer or above. Checked against
 * every ShortlistProposed application for the vacancy, not just one, since
 * saveRanking's batch can carry proposals made at different times by
 * different people.
 */
async function assertNotSelfApprovedShortlist(vacancyId, approver) {
  const proposed = await prisma.application.findMany({
    where: { vacancyId, status: 'ShortlistProposed' }
  });
  const [own, ...actingFor] = idsOf(approver);
  if (proposed.some((a) => a.shortlistProposedById === own)) {
    throw new Error('Self-approval blocked: you proposed this shortlist - a different Principal HR Officer or above must approve it');
  }
  if (proposed.some((a) => actingFor.includes(a.shortlistProposedById))) {
    throw new Error(`${FOR_DELEGATOR} proposed this shortlist - someone else must approve it`);
  }
}

/**
 * Self-approval block for the offer recommend/approve split: whoever
 * recommended an offer (Offer.recommendedById) cannot also approve it. A
 * Manager or Director meets both tiers (recommend is Principal_HR_Officer+,
 * approve is Manager+), so without this one person could carry an offer
 * from recommendation to candidate on their own. Takes the offer row the
 * caller already loaded rather than re-reading it.
 */
function assertNotSelfApprovedOffer(offer, approver) {
  const [own, ...actingFor] = idsOf(approver);
  if (offer.recommendedById != null && offer.recommendedById === own) {
    throw new Error('Self-approval blocked: you recommended this offer - someone else must check and approve it');
  }
  if (offer.recommendedById != null && actingFor.includes(offer.recommendedById)) {
    throw new Error(`${FOR_DELEGATOR} recommended this offer - someone else must approve it`);
  }
}

/**
 * The Director who approves an offer can't be the Manager who checked it -
 * two people look at every offer after its recommender.
 */
function assertNotCheckerApprovingOffer(offer, approver) {
  const [own, ...actingFor] = idsOf(approver);
  if (offer.checkedById != null && offer.checkedById === own) {
    throw new Error('You checked this offer - a different Director must approve it');
  }
  if (offer.checkedById != null && actingFor.includes(offer.checkedById)) {
    throw new Error(`${FOR_DELEGATOR} checked this offer - someone else must approve it`);
  }
}

/**
 * Computes Vacancy.status from accepted offers vs positions_required.
 * Accepts an optional Prisma client/transaction handle so callers that need
 * this to run atomically alongside an offer-status change (see
 * acceptOfferTransactionally/handleOfferDeclined below) can pass their `tx`
 * - every existing caller that doesn't pass one keeps using the plain
 * top-level `prisma` singleton exactly as before.
 */
async function recomputeVacancyStatus(vacancyId, client = prisma) {
  const vacancy = await client.vacancy.findUnique({ where: { id: vacancyId } });
  if (!vacancy) return;

  const acceptedCount = await client.offer.count({
    where: { status: 'Accepted', application: { vacancyId } }
  });

  let status = 'Open';
  if (acceptedCount >= vacancy.positionsRequired) status = 'Filled';
  else if (acceptedCount > 0) status = 'PartiallyFilled';

  if (vacancy.status !== 'Closed') {
    await client.vacancy.update({
      where: { id: vacancyId },
      data: {
        status,
        // First-fill timestamp for time-to-fill reporting - stamped once,
        // never overwritten or cleared on a later status change (see the
        // schema comment on filledAt).
        ...(status === 'Filled' && !vacancy.filledAt ? { filledAt: new Date() } : {})
      }
    });
  }
}

/**
 * Atomically flips an Approved offer to Accepted and recomputes the
 * vacancy's status in one transaction, rather than as two independent
 * sequential writes. The offer flip itself is guarded (updateMany scoped to
 * status: 'Approved') so a second concurrent accept attempt - a double
 * click, or a race with a decline - can't also succeed; it reports a
 * conflict instead.
 *
 * Capacity: two DIFFERENT candidates accepting offers for the same vacancy
 * at the same moment could previously both succeed past positionsRequired,
 * since each transaction counted accepted offers before the other
 * committed. The vacancy row is now locked (SELECT ... FOR UPDATE) as the
 * very first statement, so concurrent acceptances for one vacancy run one
 * after another, and the accepted count is checked under that lock. The
 * lock must come before any other read: under MySQL's default REPEATABLE
 * READ, a transaction's snapshot is fixed at its first plain read, so a
 * count taken after the lock is granted sees the other transaction's
 * committed acceptance. That is why vacancyId is passed in by the caller
 * rather than looked up from the offer inside the transaction. Returns
 * { full: true } without touching anything when every position is taken.
 */
// Default Prisma interactive-transaction timeout is 5s, and default maxWait
// (time to acquire a transaction slot before even starting) is 2s - both
// too tight for this DB's real-world latency (observed failing with
// "Transaction API error: Transaction not found" under normal load, not
// just when overloaded). Widened here and on handleOfferDeclined below,
// the only two interactive (multi-query, JS-driven) transactions in this
// file - saveRanking's own $transaction (vacancyController.js) is the
// simpler array/batch form, which doesn't hold a transaction open across
// JS-side awaits the way these two do, so it isn't exposed to the same risk.
async function acceptOfferTransactionally(offerId, vacancyId) {
  return prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw`SELECT positionsRequired FROM Vacancy WHERE id = ${vacancyId} FOR UPDATE`;
    const locked = lockedRows && lockedRows[0];
    if (!locked) return { conflict: true };

    const acceptedCount = await tx.offer.count({
      where: { status: 'Accepted', application: { vacancyId } }
    });
    if (acceptedCount >= Number(locked.positionsRequired)) return { full: true };

    const result = await tx.offer.updateMany({
      where: { id: offerId, status: 'Approved' },
      data: { status: 'Accepted', decidedAt: new Date() }
    });
    if (result.count === 0) return { conflict: true };

    const offer = await tx.offer.findUnique({
      where: { id: offerId },
      include: { application: { include: { vacancy: true } } }
    });
    await recomputeVacancyStatus(offer.application.vacancyId, tx);
    return { offer };
  }, { timeout: 15000, maxWait: 5000 });
}

/**
 * Closing cascade: an offer that ends without a hire - declined by the
 * candidate, expired unanswered, or withdrawn by HR - releases its position
 * to the next reserve, who is promoted to Primary so a Principal HR Officer
 * can recommend them - without restarting shortlisting. Nobody is promoted
 * once the vacancy is already filled (e.g. an offer withdrawn because the
 * last position was taken). Same atomic-guard-inside-a-transaction shape as
 * acceptOfferTransactionally: the offer only closes if it is still in one of
 * fromStatuses, so two racing actions can't both apply.
 */
// `where` narrows the guard further (an Accepted offer closes only while
// nobody has marked the candidate hired).
async function closeOffer(offerId, fromStatuses, data, where = {}) {
  // Like acceptOfferTransactionally, the vacancy row is locked as the first
  // statement, so a release and an acceptance on the same vacancy run one
  // after the other: the accepted count below then sees an acceptance that
  // just filled the last post, and no reserve is promoted onto a filled
  // vacancy. Hence the vacancy is looked up before the transaction.
  const target = await prisma.offer.findUnique({ where: { id: offerId }, select: { application: { select: { vacancyId: true } } } });
  if (!target) return { conflict: true };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Vacancy WHERE id = ${target.application.vacancyId} FOR UPDATE`;
    const result = await tx.offer.updateMany({
      where: { id: offerId, status: fromStatuses.length === 1 ? fromStatuses[0] : { in: fromStatuses }, ...where },
      data
    });
    if (result.count === 0) return { conflict: true };

    const offer = await tx.offer.findUnique({ where: { id: offerId }, include: { application: true } });
    const vacancyId = offer.application.vacancyId;
    const vacancy = await tx.vacancy.findUnique({ where: { id: vacancyId } });
    const accepted = await tx.offer.count({ where: { status: 'Accepted', application: { vacancyId } } });
    const nextReserve = vacancy && accepted < vacancy.positionsRequired ? await promoteNextReserve(tx, vacancyId) : null;

    await recomputeVacancyStatus(vacancyId, tx);
    // Principal HR Officers are told a new recommendation is needed by the
    // caller, outside this transaction - a notification must never roll
    // back the close.
    return { offer, promoted: nextReserve };
  }, { timeout: 15000, maxWait: 5000 });
}

// The next reserve comes from the approved post-interview merit list
// (meritListService), in merit order. A vacancy whose offers predate the
// merit list falls back to the old pre-interview rank/listStatus.
async function promoteNextReserve(tx, vacancyId) {
  const hasMeritList = (await tx.application.count({ where: { vacancyId, meritStatus: 'Approved' } })) > 0;
  const nextReserve = hasMeritList
    ? await tx.application.findFirst({
      where: { vacancyId, meritStatus: 'Approved', meritListStatus: 'Reserve', status: 'Interviewed', offer: null },
      orderBy: { meritRank: 'asc' }
    })
    : await tx.application.findFirst({
      where: {
        vacancyId,
        listStatus: 'Reserve',
        status: { notIn: ['Rejected', 'Withdrawn'] }
      },
      orderBy: { rank: 'asc' }
    });
  if (nextReserve) {
    await tx.application.update({
      where: { id: nextReserve.id },
      data: hasMeritList ? { meritListStatus: 'Primary' } : { listStatus: 'Primary' }
    });
  }
  return nextReserve || null;
}

// Primaries on the approved merit list still holding a post: no offer yet,
// or one that hasn't ended without a hire.
const POST_HOLDING_OFFER = ['Recommended', 'Returned', 'Approved', 'Extended', 'Accepted'];

/**
 * After positionsRequired changes on a published vacancy: its status is
 * recomputed (Filled/PartiallyFilled/Open), and on a vacancy with an
 * approved merit list, reserves move up until as many Primaries hold a post
 * as there are positions - raising the number fills the new posts from the
 * list, like a decline does. Lowering it takes nobody off Primary (they may
 * already hold an offer). Returns the applications promoted.
 */
async function rebalancePositions(vacancyId) {
  return prisma.$transaction(async (tx) => {
    // Same lock-first rule as acceptOfferTransactionally.
    const rows = await tx.$queryRaw`SELECT positionsRequired, status FROM Vacancy WHERE id = ${vacancyId} FOR UPDATE`;
    const vacancy = rows && rows[0];
    if (!vacancy || !['Open', 'PartiallyFilled', 'Filled'].includes(vacancy.status)) return { promoted: [] };

    const promoted = [];
    const hasMeritList = (await tx.application.count({ where: { vacancyId, meritStatus: 'Approved' } })) > 0;
    if (hasMeritList) {
      const holding = await tx.application.count({
        where: {
          vacancyId, meritStatus: 'Approved', meritListStatus: 'Primary',
          OR: [{ offer: null }, { offer: { status: { in: POST_HOLDING_OFFER } } }]
        }
      });
      for (let open = Number(vacancy.positionsRequired) - holding; open > 0; open -= 1) {
        const next = await promoteNextReserve(tx, vacancyId);
        if (!next) break;
        promoted.push(next);
      }
    }
    await recomputeVacancyStatus(vacancyId, tx);
    return { promoted };
  }, { timeout: 15000, maxWait: 5000 });
}

/**
 * A Primary on the approved merit list left before any offer (they withdrew
 * their application): their post goes to the next reserve, as when an offer
 * is declined - unless every position is already filled. Vacancy row locked
 * first, as everywhere offers and posts are counted. Returns the promoted
 * application, or null.
 */
async function releasePrimary(vacancyId) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT positionsRequired FROM Vacancy WHERE id = ${vacancyId} FOR UPDATE`;
    if (!rows || !rows[0]) return null;
    const accepted = await tx.offer.count({ where: { status: 'Accepted', application: { vacancyId } } });
    if (accepted >= Number(rows[0].positionsRequired)) return null;
    return promoteNextReserve(tx, vacancyId);
  }, { timeout: 15000, maxWait: 5000 });
}

// The candidate declined their issued offer.
function handleOfferDeclined(offerId, declineReason = null) {
  return closeOffer(offerId, ['Approved'], { status: 'Declined', decidedAt: new Date(), declineReason });
}

/**
 * Qualifications snapshot - freezes WORK_EXPERIENCE + EDUCATION into
 * AUDIT_LOG.payload at submission and at hire, since those tables are
 * candidate-level and reusable (current-state only).
 */
async function captureSnapshot({ entityType, entityId, candidateId, performedById = null }) {
  const [workExperience, education] = await Promise.all([
    prisma.workExperience.findMany({ where: { candidateId } }),
    prisma.education.findMany({ where: { candidateId } })
  ]);

  await prisma.auditLog.create({
    data: {
      entityType,
      entityId,
      action: `${entityType} qualifications snapshot captured`,
      performedById,
      payload: { workExperience, education, capturedAt: new Date().toISOString() }
    }
  });
}

/**
 * Audits an Internal <-> External posting-type transition. Reuses the
 * existing AuditLog table rather than inventing a new dedicated one -
 * the same pattern already used for ApplicationSnapshot/HireSnapshot.
 */
async function logVacancyPostingTypeTransition(vacancyId, fromType, toType, performedById) {
  await prisma.auditLog.create({
    data: {
      entityType: 'Vacancy',
      entityId: vacancyId,
      action: 'PostingTypeTransition',
      performedById,
      // from/to kept for rows read by older code; changes is the shape
      // auditService.history reads.
      payload: { from: fromType, to: toType, changes: { postingType: { from: fromType, to: toType } } }
    }
  });
}

module.exports = {
  assertCanShortlist,
  actingIds,
  assertNotSelfApproval,
  assertNotSelfApprovedShortlist,
  assertNotSelfApprovedOffer,
  assertNotCheckerApprovingOffer,
  recomputeVacancyStatus,
  acceptOfferTransactionally,
  handleOfferDeclined,
  closeOffer,
  rebalancePositions,
  releasePrimary,
  captureSnapshot,
  logVacancyPostingTypeTransition
};
