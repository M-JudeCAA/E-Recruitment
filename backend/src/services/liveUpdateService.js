// Live updates: who is told "something changed, go refetch", and how the
// signal gets there (realtime/dashboardSocket.js carries it).
//
// - Every audited change (config/db.js calls afterAudit for each AuditLog
//   row, however it is written) reaches every staff page as `Changed`, with
//   what changed and who changed it - so a pending approval someone else
//   decides leaves every Inbox, sidebar count, bell and open review at once.
// - The same change reaches the candidate it is about (an application,
//   offer, interview, employment check or profile of theirs) as `Changed`,
//   and any change to a vacancy reaches every candidate as `JobsChanged`.
// - A new notice (notificationService.notify, candidateNotificationService
//   .notifyCandidate) reaches its recipient as `NotificationsChanged`.
//
// Signals, never data: the payload names the record (type, id, action, who)
// and each page re-reads through the normal, permission-checked API.
//
// The scheduler worker serves no sockets, so there (isRunning() false) the
// signal goes to the API over the signed internal endpoint
// (utils/dashboardSignal.js), which hands it on. Nothing here throws or
// makes the caller wait.

const socket = require('../realtime/dashboardSocket');
const { signalDashboards } = require('../utils/dashboardSignal');

// Which candidate an audited record is about.
const CANDIDATE_OF = {
  Application: (prisma, id) => prisma.application.findUnique({ where: { id }, select: { candidateId: true } }).then((r) => r?.candidateId),
  Offer: (prisma, id) => prisma.offer.findUnique({ where: { id }, select: { application: { select: { candidateId: true } } } }).then((r) => r?.application?.candidateId),
  InterviewRound: (prisma, id) => prisma.interviewRound.findUnique({ where: { id }, select: { application: { select: { candidateId: true } } } }).then((r) => r?.application?.candidateId),
  // Employment checks are audited under the candidate's id.
  InternalProfile: (_prisma, id) => Promise.resolve(id),
  Candidate: (_prisma, id) => Promise.resolve(id)
};

// Unit tests drive the code without the API's sockets; nothing to tell.
const quiet = () => !socket.isRunning() && process.env.NODE_ENV === 'test';

/**
 * Sends one signal: to every staff page (allStaff), some staff (staffIds),
 * some candidates (candidateIds) and/or every candidate (allCandidates).
 */
function signal({ event, payload = {}, allStaff = false, staffIds = [], candidateIds = [], allCandidates = false }) {
  try {
    if (quiet()) return;
    if (socket.isRunning()) {
      if (allStaff) socket.broadcastDashboardEvent(event, payload);
      else if (staffIds.length) socket.sendToStaff(staffIds, event, payload);
      if (allCandidates) socket.broadcastToCandidates(event, payload);
      else if (candidateIds.length) socket.sendToCandidates(candidateIds, event, payload);
      return;
    }
    // The scheduler worker: through the API.
    signalDashboards(event, { ...payload, _to: { allStaff, staffIds, candidateIds, allCandidates } }).catch(() => {});
  } catch {
    // A lost signal only means a page refreshes on its next load.
  }
}

/** What the internal endpoint does with a relayed signal (app.js). */
function deliverRelayed(event, payload) {
  const { _to: to, ...rest } = payload || {};
  if (!to || typeof to !== 'object') {
    socket.broadcastDashboardEvent(event, rest); // a plain dashboard signal, as before
    return;
  }
  const ids = (list) => (Array.isArray(list) ? list.map(Number).filter(Number.isInteger) : []);
  signal({
    event, payload: rest,
    allStaff: to.allStaff === true, staffIds: ids(to.staffIds),
    candidateIds: ids(to.candidateIds), allCandidates: to.allCandidates === true
  });
}

/**
 * After an AuditLog row is written. Called a moment later (config/db.js),
 * so the change the row records has normally been committed by then.
 */
async function afterAudit(row) {
  try {
    if (quiet() || !row || !row.entityType) return;
    const { entityType, entityId, action, performedById } = row;
    const inApi = socket.isRunning();
    const prisma = require('../config/db');

    if (!inApi || socket.hasClients('staff')) {
      const by = performedById
        ? await prisma.staffUser.findUnique({ where: { id: performedById }, select: { name: true } }).then((s) => s?.name || null).catch(() => null)
        : null;
      signal({ event: 'Changed', payload: { entityType, entityId, action, by }, allStaff: true });
    }

    if (inApi && !socket.hasClients('candidate')) return;
    if (entityType === 'Vacancy') {
      signal({ event: 'JobsChanged', payload: { vacancyId: entityId }, allCandidates: true });
      return;
    }
    const find = CANDIDATE_OF[entityType];
    if (!find || !entityId) return;
    const candidateId = await find(prisma, entityId).catch(() => null);
    if (candidateId) signal({ event: 'Changed', payload: { entityType, entityId }, candidateIds: [candidateId] });
  } catch {
    // Never in the way of the change itself.
  }
}

/** A new in-app notice for a staff member. */
function noticeForStaff(staffId) {
  signal({ event: 'NotificationsChanged', staffIds: [staffId] });
}

/** A new in-app notice for a candidate. */
function noticeForCandidate(candidateId, type) {
  signal({ event: 'NotificationsChanged', payload: { type }, candidateIds: [candidateId] });
}

module.exports = { signal, deliverRelayed, afterAudit, noticeForStaff, noticeForCandidate };
