const prisma = require('../config/db');
const { ROLE_RANK } = require('../middleware/auth');
const delegationModel = require('../models/delegationModel');
const conflictOfInterest = require('./conflictOfInterestService');
const vacancyProgress = require('./vacancyProgressService');
const { computeStatus } = require('./slaStatusService');

// The staff Inbox (GET /api/dashboard/inbox): everything waiting for the
// person looking, in one list, oldest due first - the landing page for every
// staff role. Built from the same facts as each vacancy's "Next step"
// (vacancyProgressService), plus the approvals that are not one per vacancy
// (each offer, each department, data requests) and candidates' requests for
// another interview time.
//
// Who sees a step: the tier responsible for it and the tier directly above
// (a Senior HR Officer's step also shows to the Principal HR Officer), using
// the viewer's own rank or an active delegation's, whichever is higher. The
// self-approval rules apply: nobody is asked to approve what they proposed.
// Vacancies the viewer (or their delegator) applied for are left out.

const DAY = 24 * 60 * 60 * 1000;

const KIND_LABELS = {
  approveVacancy: 'Vacancy approval',
  resubmitVacancy: 'Returned vacancy',
  approveCommittee: 'Committee approval',
  reviseCommittee: 'Returned committee',
  committeeSetup: 'Committee setup',
  openRating: 'Open rating',
  proposeShortlist: 'Propose shortlist',
  approveShortlist: 'Shortlist approval',
  beginReview: 'Begin review',
  attachExco: 'EXCO approval',
  scheduleInterviews: 'Schedule interviews',
  recordResults: 'Record results',
  proposeMerit: 'Propose merit list',
  approveMerit: 'Merit list approval',
  draftOffer: 'Draft offer',
  reviseOffer: 'Returned offer',
  markHired: 'Mark as hired',
  noApplicants: 'No applicants'
};

const REVIEW_KINDS = { approveVacancy: 'vacancy', approveCommittee: 'committee' };

function inAudience(role, rank) {
  if (!role) return false;
  const base = ROLE_RANK[role];
  // "Manager" steps are Manager-or-Director steps already.
  const top = role === 'Manager' ? ROLE_RANK.Director : base + 1;
  return rank >= base && rank <= top;
}

function waitingLabel(since, now) {
  if (!since) return null;
  const days = Math.floor((now - new Date(since)) / DAY);
  return days <= 0 ? 'waiting since today' : days === 1 ? 'waiting 1 day' : `waiting ${days} days`;
}

function dueLabel(dueAt, now) {
  const hours = (new Date(dueAt) - now) / (60 * 60 * 1000);
  if (hours <= 0) {
    const over = Math.ceil(-hours / 24);
    return over <= 1 ? '1 day over' : `${over} days over`;
  }
  if (hours < 24) return 'due today';
  const days = Math.ceil(hours / 24);
  return days === 1 ? 'due tomorrow' : `due in ${days} days`;
}

function group(item, now) {
  if (item.overdue) return 'overdue';
  if (item.dueAt && new Date(item.dueAt) - now > 7 * DAY) return 'later';
  return item.group || 'week';
}

async function sla(taskType, id, since, now) {
  try {
    const status = await computeStatus(taskType, { id, since });
    if (!status) return {};
    return { dueAt: status.dueAt, overdue: status.isOverdue, due: dueLabel(status.dueAt, now) };
  } catch {
    return {};
  }
}

async function forStaff(req, now = new Date()) {
  const me = req.user.id;
  const ownRank = ROLE_RANK[req.user.role] || 0;
  const [actingFor, delegatedTo] = await Promise.all([
    delegationModel.findActiveForDelegate(me, now),
    prisma.delegation.findFirst({
      where: { delegatorId: me, startDate: { lte: now }, endDate: { gte: now } },
      select: { endDate: true, delegate: { select: { name: true } } }
    })
  ]);
  const delegatedRank = actingFor ? ROLE_RANK[actingFor.delegator?.role] || 0 : 0;
  const rank = Math.max(ownRank, delegatedRank);
  // Acting under a delegation, the delegator's conflicts apply too.
  if (delegatedRank > ownRank) req.actingAsDelegateFor = actingFor.delegatorId;
  const conflicted = await conflictOfInterest.conflictedVacancyIds(req);
  const notConflicted = conflicted.length ? { notIn: conflicted } : undefined;

  const vacancies = await prisma.vacancy.findMany({
    where: { status: { in: ['PendingApproval', 'Returned', 'Open', 'PartiallyFilled', 'Filled'] }, ...(notConflicted ? { id: notConflicted } : {}) },
    select: {
      id: true, jobRef: true, title: true, status: true, deadline: true, positionsRequired: true, createdById: true,
      createdAt: true, approvalRequestedAt: true, returnReason: true, reviewStartedAt: true,
      department: { select: { name: true, directorate: { select: { name: true } } } }
    }
  }) || [];
  const progress = await vacancyProgress.progressFor(vacancies, now);

  const items = [];
  for (const v of vacancies) {
    const next = progress.get(v.id)?.next;
    if (!next || next.kind === 'approveOffer') continue; // offers are listed one by one below
    const mine = next.kind === 'resubmitVacancy' ? v.createdById === me || inAudience(next.role, rank) : inAudience(next.role, rank);
    if (!mine || next.excludeStaffIds?.includes(me)) continue;
    const item = {
      key: `vacancy-${v.id}-${next.kind}`,
      kind: KIND_LABELS[next.kind] || next.short,
      title: `${v.title} · ${v.department?.name || ''}${v.department?.directorate?.name ? `, ${v.department.directorate.name}` : ''}`,
      context: next.text,
      vacancyId: v.id,
      jobRef: v.jobRef,
      tab: next.tab,
      review: REVIEW_KINDS[next.kind] ? { type: REVIEW_KINDS[next.kind], vacancyId: v.id } : null,
      waiting: waitingLabel(next.since, now)
    };
    if (next.kind === 'approveVacancy') Object.assign(item, await sla('VacancyApproval', v.id, next.since, now));
    items.push(item);
  }

  if (rank >= ROLE_RANK.Manager) {
    const offers = await prisma.offer.findMany({
      where: { status: 'Recommended', ...(notConflicted ? { application: { vacancyId: notConflicted } } : {}) },
      select: {
        id: true, recommendedById: true, recommendedDate: true,
        recommendedBy: { select: { name: true } },
        application: { select: { id: true, vacancyId: true, candidate: { select: { fullName: true } }, vacancy: { select: { title: true, jobRef: true } } } }
      }
    }) || [];
    for (const o of offers) {
      if (o.recommendedById === me) continue;
      items.push({
        key: `offer-${o.id}`,
        kind: 'Offer approval',
        title: `${o.application.candidate.fullName} · ${o.application.vacancy.title}`,
        context: `Recommended by ${o.recommendedBy?.name || 'HR'}${o.recommendedDate ? ` on ${new Date(o.recommendedDate).toDateString().slice(4)}` : ''}.`,
        vacancyId: o.application.vacancyId,
        jobRef: o.application.vacancy.jobRef,
        tab: 'merit',
        review: { type: 'offer', offerId: o.id, applicationId: o.application.id, vacancyId: o.application.vacancyId },
        ...(await sla('OfferApproval', o.id, o.recommendedDate, now))
      });
    }

    const requests = await prisma.dataSubjectRequest.findMany({ where: { status: 'Pending' }, select: { id: true, createdAt: true } }) || [];
    for (const r of requests) {
      items.push({
        key: `data-request-${r.id}`,
        kind: 'Data request',
        title: 'A candidate asked for their data to be erased',
        context: 'Complete it, or refuse it with a reason, under Settings & data.',
        link: '/hr/settings',
        waiting: waitingLabel(r.createdAt, now),
        overdue: now - new Date(r.createdAt) > 30 * DAY
      });
    }
  }

  if (rank >= ROLE_RANK.Principal_HR_Officer && rank <= ROLE_RANK.Manager) {
    const departments = await prisma.department.findMany({
      where: { status: 'Pending' },
      select: { id: true, name: true, createdAt: true, createdBy: { select: { name: true } }, directorate: { select: { name: true } } }
    }) || [];
    for (const d of departments) {
      items.push({
        key: `department-${d.id}`,
        kind: 'Department approval',
        title: `${d.name} under ${d.directorate?.name || ''}`,
        context: `Proposed by ${d.createdBy?.name || 'HR'}.`,
        link: '/hr/departments',
        review: { type: 'department', departmentId: d.id, name: d.name, directorate: d.directorate?.name },
        ...(await sla('DepartmentApproval', d.id, d.createdAt, now))
      });
    }
  }

  if (rank >= ROLE_RANK.HR_Officer && rank <= ROLE_RANK.Senior_HR_Officer) {
    const requests = await prisma.interviewRound.findMany({
      where: { status: 'Scheduled', candidateResponse: 'RescheduleRequested', ...(notConflicted ? { application: { vacancyId: notConflicted } } : {}) },
      select: {
        id: true, scheduledDate: true, candidateRespondedAt: true, candidateResponseNote: true,
        application: { select: { vacancyId: true, candidate: { select: { fullName: true } }, vacancy: { select: { title: true } } } }
      }
    }) || [];
    for (const r of requests) {
      items.push({
        key: `reschedule-${r.id}`,
        kind: 'Reschedule request',
        title: `${r.application.candidate.fullName} asked for another time`,
        context: `${r.application.vacancy.title}${r.candidateResponseNote ? ` · “${r.candidateResponseNote}”` : ''}`,
        link: `/hr/interviews?round=${r.id}`,
        waiting: waitingLabel(r.candidateRespondedAt, now)
      });
    }
  }

  if (rank <= ROLE_RANK.Principal_HR_Officer) {
    for (const v of vacancies) {
      if (!['Open', 'PartiallyFilled'].includes(v.status) || !v.deadline) continue;
      const left = new Date(v.deadline) - now;
      if (left < 0 || left > 7 * DAY) continue;
      const days = Math.ceil(left / DAY);
      items.push({
        key: `closing-${v.id}`,
        kind: 'Applications close',
        title: `${v.title} · ${progress.get(v.id)?.counts.applicants || 0} applications so far`,
        context: days <= 1 ? 'Applications close today.' : `Applications close in ${days} days.`,
        vacancyId: v.id,
        jobRef: v.jobRef,
        tab: 'applicants',
        group: 'later',
        info: true
      });
    }
  }

  for (const item of items) item.group = group(item, now);
  const order = { overdue: 0, week: 1, later: 2 };
  items.sort((a, b) => order[a.group] - order[b.group]
    || (a.dueAt && b.dueAt ? new Date(a.dueAt) - new Date(b.dueAt) : a.dueAt ? -1 : b.dueAt ? 1 : 0));

  const vacancyIdFilter = notConflicted ? { vacancyId: notConflicted } : {};
  const [interviewsAhead, offersOut, applicationsRecent] = await Promise.all([
    prisma.interviewRound.count({ where: { status: 'Scheduled', scheduledDate: { gte: now, lt: new Date(now.getTime() + 7 * DAY) }, application: vacancyIdFilter } }),
    prisma.offer.count({ where: { status: 'Approved', application: vacancyIdFilter } }),
    prisma.application.count({ where: { status: { not: 'Draft' }, submittedDate: { gte: new Date(now.getTime() - 30 * DAY) }, ...vacancyIdFilter } })
  ]);
  const inProgress = vacancies.filter((v) => v.status !== 'Filled').length;

  return {
    items,
    figures: [
      { value: inProgress, label: inProgress === 1 ? 'vacancy in progress' : 'vacancies in progress' },
      { value: interviewsAhead || 0, label: 'interviews in the next 7 days' },
      { value: offersOut || 0, label: offersOut === 1 ? 'offer with a candidate' : 'offers with candidates' },
      { value: applicationsRecent || 0, label: 'applications in the last 30 days' }
    ],
    delegation: {
      actingFor: actingFor && delegatedRank > 0 ? { name: actingFor.delegator.name, role: actingFor.delegator.role, until: actingFor.endDate } : null,
      delegatedTo: delegatedTo ? { name: delegatedTo.delegate.name, until: delegatedTo.endDate } : null
    }
  };
}

module.exports = { forStaff, inAudience, KIND_LABELS };
