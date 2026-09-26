const prisma = require('../config/db');

// Everything the Interview Hub shows for one round: the candidate (name and
// contact only - not the full profile), the vacancy, and the panel.
const ROUND_INCLUDE = {
  application: {
    select: {
      id: true, status: true, rank: true, listStatus: true, candidateId: true,
      candidate: { select: { id: true, fullName: true, email: true, phone: true, candidateType: true } },
      vacancy: { select: { id: true, jobRef: true, title: true, createdById: true, positionsRequired: true } },
      offer: { select: { id: true, status: true } }
    }
  },
  panelMembers: { orderBy: [{ isChair: 'desc' }, { id: 'asc' }] },
  scheduledBy: { select: { id: true, name: true } },
  conductedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } }
};

// A clash check only needs who and where, not the whole round.
const CLASH_SELECT = {
  id: true, scheduledDate: true, durationMinutes: true, mode: true, location: true,
  application: {
    select: {
      candidateId: true,
      candidate: { select: { fullName: true } },
      vacancy: { select: { jobRef: true, title: true } }
    }
  },
  panelMembers: {
    where: { recusedAt: null },
    select: { name: true, email: true, staffUserId: true }
  }
};

function buildListWhere({ from, to, vacancyId, status, search, sessionKey }) {
  const where = {};
  if (from || to) {
    where.scheduledDate = {};
    if (from) where.scheduledDate.gte = from;
    if (to) where.scheduledDate.lt = to;
  }
  if (status) where.status = Array.isArray(status) ? { in: status } : status;
  if (sessionKey) where.sessionKey = sessionKey;
  const application = {};
  if (vacancyId) application.vacancyId = vacancyId;
  if (search) application.candidate = { fullName: { contains: search } };
  if (Object.keys(application).length) where.application = application;
  return where;
}

/**
 * Creates one or more rounds (a single interview, or a whole bulk-scheduled
 * session) and moves each application to InterviewScheduled, all in one
 * transaction. entries: [{ round: {...InterviewRound data minus
 * roundNumber}, panel: [panelMemberModel.toRow shape minus interviewRoundId] }].
 *
 * The application update is conditional on it still being schedulable, so
 * an application rejected or offered between the caller's check and this
 * write rolls the whole session back instead of being dragged back to
 * InterviewScheduled. Round numbers are counted inside the transaction.
 */
function createSession(entries, schedulableStatuses) {
  return prisma.$transaction(async (tx) => {
    const created = [];
    for (const { round, panel } of entries) {
      const moved = await tx.application.updateMany({
        where: { id: round.applicationId, status: { in: schedulableStatuses }, offer: null },
        data: { status: 'InterviewScheduled' }
      });
      if (moved.count === 0) {
        const err = new Error(`Application ${round.applicationId} can no longer have an interview scheduled`);
        err.code = 'NOT_SCHEDULABLE';
        err.applicationId = round.applicationId;
        throw err;
      }
      const existing = await tx.interviewRound.count({ where: { applicationId: round.applicationId } });
      const row = await tx.interviewRound.create({ data: { ...round, roundNumber: existing + 1 } });
      if (panel.length > 0) {
        await tx.panelMember.createMany({ data: panel.map((p) => ({ ...p, interviewRoundId: row.id })) });
      }
      created.push(row);
    }
    return created;
  }, { timeout: 30000 });
}

module.exports = {
  ROUND_INCLUDE,
  createSession,
  create: (data) => prisma.interviewRound.create({ data }),
  findById: (id) => prisma.interviewRound.findUnique({ where: { id } }),
  findDetailed: (id) => prisma.interviewRound.findUnique({ where: { id }, include: ROUND_INCLUDE }),
  findManyDetailed: (ids) => prisma.interviewRound.findMany({
    where: { id: { in: ids } }, include: ROUND_INCLUDE, orderBy: { scheduledDate: 'asc' }
  }),
  update: (id, data) => prisma.interviewRound.update({ where: { id }, data }),
  // Atomic conditional update - scoping the write to recommendation: null
  // means a second finalize call on the same round (double-click, or two
  // HR officers racing) can't silently overwrite an already-finalized
  // recommendation; the caller sees count 0 and reports a conflict instead.
  updateIfNoRecommendation: (id, data) => prisma.interviewRound.updateMany({ where: { id, recommendation: null }, data }),
  // Same guard idea for cancel/no-show/reschedule: only a round that is
  // still Scheduled can move, so two people acting at once can't both win.
  updateIfScheduled: (id, data) => prisma.interviewRound.updateMany({ where: { id, status: 'Scheduled' }, data }),
  countByApplication: (applicationId) => prisma.interviewRound.count({ where: { applicationId } }),
  findByApplication: (applicationId) => prisma.interviewRound.findMany({ where: { applicationId } }),

  // The Hub's agenda/list. Rounds with no date sort last.
  list: (filters, take = 500) => prisma.interviewRound.findMany({
    where: buildListWhere(filters),
    include: ROUND_INCLUDE,
    orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
    take
  }),

  // Every still-Scheduled round that could overlap [from, to) - the window
  // is widened by the caller to cover the longest plausible interview, and
  // the exact overlap is worked out in interviewSchedulingService.
  scheduledBetween: (from, to, excludeIds = []) => prisma.interviewRound.findMany({
    where: {
      status: 'Scheduled',
      scheduledDate: { gte: from, lt: to },
      ...(excludeIds.length ? { id: { notIn: excludeIds } } : {})
    },
    select: CLASH_SELECT
  }),

  // Rounds still Scheduled - the Hub's "needs attention" buckets are
  // worked out from these in the controller.
  openRounds: () => prisma.interviewRound.findMany({
    where: { status: 'Scheduled' },
    include: ROUND_INCLUDE,
    orderBy: { scheduledDate: 'asc' }
  }),

  // A vacancy's rounds with their panels, for the Scorecards comparison and
  // "reuse the last panel/rubric" suggestions.
  findByVacancy: (vacancyId) => prisma.interviewRound.findMany({
    where: { application: { vacancyId } },
    include: ROUND_INCLUDE,
    orderBy: [{ createdAt: 'desc' }]
  }),

  // scripts/sendInterviewReminders.js
  dueForReminder: (from, to) => prisma.interviewRound.findMany({
    where: { status: 'Scheduled', reminderSentAt: null, scheduledDate: { gte: from, lte: to } },
    include: ROUND_INCLUDE
  }),
  overdueForScores: (before) => prisma.interviewRound.findMany({
    where: { status: 'Scheduled', recommendation: null, scoreNudgeSentAt: null, scheduledDate: { lt: before } },
    include: ROUND_INCLUDE
  })
};
