const prisma = require('../config/db');

// A notice asking staff to act (approve, decide, answer, record) stops being
// news once someone has acted on it - whoever it was. clearResolved looks at
// the tasks behind a list of unread in-app notices, and for each one no
// longer waiting marks every recipient's unread in-app notice about it read,
// so it leaves everyone's bell, not only the one person's who acted.
//
// It runs when the bell loads (notificationController.listMine, polled), so
// it covers every way a task gets done - in the app, by a scheduled job or
// by another approver - without each action having to remember to clear.
// Notices that only inform (ApprovalGiven, OfferDeclined, ...) are left for
// their reader.
//
// Each resolver takes the task ids with unread notices and returns, for those
// no longer waiting, the time up to which notices about it are done with
// (`now` for the whole task; an offer's check stage ends at checkedAt, while
// the Directors' notices sent after it stay).

const ids = (rows, key = 'id') => new Set((rows || []).map((r) => r[key]));
// Every id not in the waiting set is done with, now.
const doneUnless = (taskIds, waiting, now) => new Map(taskIds.filter((id) => !waiting.has(id)).map((id) => [id, now]));

const byStatus = (model, status) => async (taskIds, now) => doneUnless(taskIds,
  ids(await prisma[model].findMany({ where: { id: { in: taskIds }, status }, select: { id: true } })), now);

// An interview round still waiting for HR: booked, not yet held or recorded.
const roundWaiting = (extra = {}) => async (taskIds, now) => doneUnless(taskIds,
  ids(await prisma.interviewRound.findMany({ where: { id: { in: taskIds }, status: 'Scheduled', ...extra }, select: { id: true } })), now);

const RESOLVERS = {
  VacancyApproval: byStatus('vacancy', 'PendingApproval'),
  VacancyReturned: byStatus('vacancy', 'Returned'),
  // Vacancy ids: waiting while anyone on it is still proposed.
  ShortlistProposed: async (taskIds, now) => doneUnless(taskIds,
    ids(await prisma.application.findMany({ where: { vacancyId: { in: taskIds }, status: 'ShortlistProposed' }, select: { vacancyId: true } }), 'vacancyId'), now),
  MeritListProposed: async (taskIds, now) => doneUnless(taskIds,
    ids(await prisma.application.findMany({ where: { vacancyId: { in: taskIds }, meritStatus: 'Proposed' }, select: { vacancyId: true } }), 'vacancyId'), now),
  // One task at two stages: the Managers' check, then the Directors'
  // approval. Once checked, the check notices (sent before) are done.
  OfferApproval: async (taskIds, now) => {
    const offers = await prisma.offer.findMany({ where: { id: { in: taskIds } }, select: { id: true, status: true, checkedAt: true } });
    const found = new Map((offers || []).map((o) => [o.id, o]));
    const done = new Map();
    for (const id of taskIds) {
      const offer = found.get(id);
      if (!offer || offer.status !== 'Recommended') done.set(id, now);
      else if (offer.checkedAt) done.set(id, new Date(offer.checkedAt));
    }
    return done;
  },
  OfferReturned: byStatus('offer', 'Returned'),
  CommitteeNominationSubmitted: async (taskIds, now) => doneUnless(taskIds,
    ids(await prisma.shortlistExercise.findMany({ where: { id: { in: taskIds }, nominationStatus: 'Submitted' }, select: { id: true } })), now),
  DirectorateApproval: byStatus('directorate', 'Pending'),
  DepartmentApproval: byStatus('department', 'Pending'),
  PositionApproval: byStatus('position', 'Pending'),
  DataErasureRequested: byStatus('dataSubjectRequest', 'Pending'),
  // Answered by rescheduling (which resets the response) or cancelling.
  InterviewRescheduleRequested: roundWaiting({ candidateResponse: 'RescheduleRequested' }),
  InterviewResultsOverdue: roundWaiting(),
  StaffGroupSyncFailed: async (taskIds, now) => doneUnless(taskIds,
    ids(await prisma.staffUser.findMany({ where: { id: { in: taskIds }, entraGroupState: 'Failed' }, select: { id: true } })), now)
};

/**
 * Clear, for everyone, the unread in-app notices among `notifications`
 * whose task has been dealt with. Returns the ids of those in the list that
 * were cleared. Never throws.
 */
async function clearResolved(notifications, now = new Date()) {
  const cleared = new Set();
  try {
    const tasks = new Map();
    for (const n of notifications || []) {
      if (!RESOLVERS[n.taskType] || !n.taskId) continue;
      if (!tasks.has(n.taskType)) tasks.set(n.taskType, new Set());
      tasks.get(n.taskType).add(n.taskId);
    }
    for (const [taskType, taskIds] of tasks) {
      const done = await RESOLVERS[taskType]([...taskIds], now);
      for (const [taskId, until] of done) {
        await prisma.notification.updateMany({
          where: { taskType, taskId, channel: 'InApp', readAt: null, sentAt: { lte: until } },
          data: { readAt: now }
        });
        for (const n of notifications) {
          if (n.taskType === taskType && n.taskId === taskId && new Date(n.sentAt) <= until) cleared.add(n.id);
        }
      }
    }
  } catch (err) {
    console.error('Failed to clear notices about finished tasks:', err);
  }
  return cleared;
}

module.exports = { clearResolved, RESOLVERS };
