const prisma = require('../config/db');
const { ROLE_RANK } = require('../middleware/auth');
const { notify } = require('./notificationService');
const conflictOfInterest = require('./conflictOfInterestService');
const { linkFor } = require('../utils/notificationLinks');

// A new approval request reaches everyone who may approve it, by email and
// in-app, the moment it is made - the same people the Inbox lists it for
// (inboxService.inAudience): the tier that approves and the tier above
// (Manager steps go to Managers and Directors), plus anyone acting for one
// of them under an active delegation. Never whoever made the request (the
// self-approval rule; also not their delegates acting on their authority),
// and never a staff member who applied for the vacancy (conflict of
// interest). Someone who still has an unread notice about the same request
// isn't sent another - a shortlist proposed one candidate at a time is one
// notice, not one per candidate.
//
// The notice opens the request's review in the Inbox
// (utils/notificationLinks.js). Never throws - a request that was made
// stands even when the notice can't go out.

// What each kind of request is, who approves it (the role whose tier and
// the tier above are asked) and the notice's type.
const KINDS = {
  vacancy: { taskType: 'VacancyApproval', role: 'Manager', what: 'vacancy' },
  offer: { taskType: 'OfferApproval', role: 'Manager', what: 'offer' },
  shortlist: { taskType: 'ShortlistProposed', role: 'Principal_HR_Officer', what: 'interview shortlist' },
  merit: { taskType: 'MeritListProposed', role: 'Principal_HR_Officer', what: 'merit list' },
  committee: { taskType: 'CommitteeNominationSubmitted', role: 'Director', what: 'shortlisting committee' },
  directorate: { taskType: 'DirectorateApproval', role: 'Principal_HR_Officer', what: 'directorate' },
  department: { taskType: 'DepartmentApproval', role: 'Principal_HR_Officer', what: 'department' },
  position: { taskType: 'PositionApproval', role: 'Principal_HR_Officer', what: 'position' }
};

// The roles in a step's audience - as inboxService.inAudience.
function audienceRoles(role) {
  const base = ROLE_RANK[role];
  const top = role === 'Manager' ? ROLE_RANK.Director : base + 1;
  return Object.keys(ROLE_RANK).filter((r) => ROLE_RANK[r] >= base && ROLE_RANK[r] <= top);
}

/**
 * Staff ids who may approve a request of this kind: active staff in the
 * audience roles and the active delegates of anyone in them, less
 * excludeIds (whoever made it) and, for a vacancy, its applicants.
 */
async function approverIds(kind, { excludeIds = [], vacancyId = null, now = new Date() } = {}) {
  const roles = audienceRoles(KINDS[kind].role);
  const excluded = new Set(excludeIds.filter(Boolean));
  const [staff, delegations, applicants] = await Promise.all([
    prisma.staffUser.findMany({ where: { active: true, role: { in: roles } }, select: { id: true } }),
    prisma.delegation.findMany({
      where: { startDate: { lte: now }, endDate: { gte: now }, delegator: { active: true, role: { in: roles } }, delegate: { active: true } },
      select: { delegatorId: true, delegateId: true }
    }),
    vacancyId ? conflictOfInterest.staffIdsAppliedFor(vacancyId) : []
  ]);
  const ids = new Set((staff || []).map((s) => s.id));
  // Acting on the request-maker's own authority can't approve it.
  for (const d of delegations || []) if (!excluded.has(d.delegatorId)) ids.add(d.delegateId);
  for (const id of [...excluded, ...(applicants || [])]) ids.delete(id);
  return [...ids];
}

/**
 * Tell the approvers about a new request. kind: a key of KINDS; taskId:
 * the notice's task (the vacancy for vacancy/shortlist/merit, the offer,
 * the committee exercise, the organisation item); message: the in-app
 * text; link: where it opens (default: its Inbox review).
 */
async function notifyApprovers(kind, { taskId, message, excludeIds = [], vacancyId = null, link } = {}) {
  try {
    const { taskType } = KINDS[kind];
    const recipients = await approverIds(kind, { excludeIds, vacancyId });
    if (!recipients.length) return [];
    const alreadyTold = new Set(((await prisma.notification.findMany({
      where: { taskType, taskId, channel: 'InApp', readAt: null, recipientId: { in: recipients } },
      select: { recipientId: true }
    })) || []).map((n) => n.recipientId));
    const path = link || await linkFor(taskType, taskId);
    const toTell = recipients.filter((id) => !alreadyTold.has(id));
    for (const id of toTell) {
      await notify(id, taskType, taskId, message, { link: path }).catch((err) => console.error(`Failed to notify staff ${id} of ${taskType} ${taskId}:`, err));
    }
    return toTell;
  } catch (err) {
    console.error(`Failed to notify approvers of ${kind} ${taskId}:`, err);
    return [];
  }
}

// "UCAA/ADV/EXT/012/2026 Accountant"
const vacancyName = (v) => [v?.jobRef, v?.title].filter(Boolean).join(' ');

/**
 * An interview shortlist was proposed (one candidate at a time, by ranking,
 * or from the committee's ranking). Not to anyone who proposed part of it.
 * actor: req.user.
 */
async function shortlistProposed(vacancyId, actor) {
  try {
    const [vacancy, proposers] = await Promise.all([
      prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { jobRef: true, title: true } }),
      prisma.application.findMany({ where: { vacancyId, status: 'ShortlistProposed' }, select: { shortlistProposedById: true } })
    ]);
    return await notifyApprovers('shortlist', {
      taskId: vacancyId,
      vacancyId,
      excludeIds: [actor.id, ...(proposers || []).map((p) => p.shortlistProposedById)],
      message: `${actor.name || 'HR'} proposed the interview shortlist for ${vacancyName(vacancy)} for your approval.`
    });
  } catch (err) {
    console.error(`Failed to notify approvers of the shortlist for vacancy ${vacancyId}:`, err);
    return [];
  }
}

module.exports = { notifyApprovers, approverIds, audienceRoles, shortlistProposed, KINDS, vacancyName };
