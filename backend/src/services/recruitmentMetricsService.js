const prisma = require('../config/db');
const { labelOf, SOURCES } = require('../utils/applicationSources');
const { levelFromInput } = require('../utils/positionLevels');

// The recruitment dashboard (FR-ATS-070 to 074): every metric with its
// formula, data source and refresh (FR-ATS-071), the rows behind it for
// drill-down, filtered by directorate, department, position, grade, location,
// advert type and date range (FR-ATS-072), and exportable (exportController /
// the page's print). Computed live from the database on each request.
//
// The date range picks vacancies by when they were raised (createdAt) - a
// cohort: every metric then follows those vacancies through to today. The
// current-state metrics (open positions, requisition aging) ignore it.
// No diversity data is held, so none can reach these views (FR-ATS-075).

const DAY = 24 * 60 * 60 * 1000;
const REFRESH = 'Live - worked out from the records each time the dashboard is opened';
const round1 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const pct = (a, b) => (b > 0 ? round1((a / b) * 100) : null);
const days = (from, to) => (from && to ? (new Date(to) - new Date(from)) / DAY : null);
const avg = (list) => (list.length ? round1(list.reduce((s, x) => s + x, 0) / list.length) : null);
function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}
const minDate = (dates) => {
  const t = dates.filter(Boolean).map((d) => new Date(d).getTime());
  return t.length ? new Date(Math.min(...t)) : null;
};
const isoDay = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

/** Parses the query into filters; unknown values are ignored. */
function parseFilters(q = {}) {
  const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const date = (v, endOfDay) => {
    if (!v) return null;
    const d = new Date(`${String(v).slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return {
    from: date(q.from), to: date(q.to, true),
    directorateId: int(q.directorateId), departmentId: int(q.departmentId), positionId: int(q.positionId),
    level: q.grade ? levelFromInput(q.grade) : null,
    location: typeof q.location === 'string' && q.location.trim() ? q.location.trim().slice(0, 100) : null,
    postingType: ['Internal', 'External'].includes(q.postingType) ? q.postingType : null
  };
}

// The organisation part of the filter (no dates), as a Prisma where.
function orgWhere(f) {
  return {
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.directorateId ? { department: { directorateId: f.directorateId } } : {}),
    ...(f.positionId ? { positionId: f.positionId } : {}),
    ...(f.level ? { position: { level: f.level } } : {}),
    ...(f.location ? { location: { contains: f.location } } : {}),
    ...(f.postingType ? { postingType: f.postingType } : {})
  };
}

async function load(f, excludeVacancyIds) {
  const where = {
    ...orgWhere(f),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(excludeVacancyIds.length ? { id: { notIn: excludeVacancyIds } } : {})
  };
  return prisma.vacancy.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, jobRef: true, title: true, status: true, positionsRequired: true, createdAt: true, approvedAt: true,
      approvalRequestedAt: true, deadline: true, postingType: true, location: true,
      department: { select: { id: true, name: true, directorate: { select: { name: true } } } },
      excoShortlistApprovals: { select: { approvedOn: true, uploadedAt: true } },
      shortlistExercise: {
        select: {
          status: true,
          members: { select: { submittedAt: true, assignments: { select: { conflictAt: true, _count: { select: { ratings: true } } } } } },
          criteria: true
        }
      },
      applications: {
        where: { status: { not: 'Draft' } },
        select: {
          id: true, status: true, submittedDate: true, createdAt: true, source: true, shortlistProposedAt: true, shortlistApprovedAt: true,
          excoApprovalId: true, meritApprovedAt: true, candidate: { select: { fullName: true } },
          interviewRounds: { select: { status: true, scheduledDate: true } },
          offer: { select: { status: true, approvedDate: true, decidedAt: true } },
          hire: { select: { hiredAt: true } }
        }
      },
      _count: { select: { applications: true } }
    }
  });
}

function timeToHire(vacancies) {
  const rows = [];
  for (const v of vacancies) {
    for (const a of v.applications) {
      if (a.offer?.status !== 'Accepted' || !v.approvedAt) continue;
      rows.push({ jobRef: v.jobRef, title: v.title, candidate: a.candidate.fullName, approved: isoDay(v.approvedAt), accepted: isoDay(a.offer.decidedAt), days: round1(days(v.approvedAt, a.offer.decidedAt)) });
    }
  }
  const list = rows.map((r) => r.days).filter((d) => d != null);
  return {
    key: 'timeToHire', label: 'Time to hire', value: avg(list), unit: 'days',
    summary: list.length ? `average over ${list.length} hire(s); median ${median(list)} days` : 'no hires yet',
    formula: 'Days from the vacancy\'s approval to the candidate accepting the offer, averaged over every accepted offer.',
    source: 'Vacancy.approvedAt, Offer.decidedAt (accepted offers)',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['candidate', 'Candidate'], ['approved', 'Vacancy approved'], ['accepted', 'Offer accepted'], ['days', 'Days']],
    rows
  };
}

function sourceOfHire(vacancies) {
  const counts = new Map([...SOURCES.map((s) => [s.key, { applicants: 0, hires: 0 }]), [null, { applicants: 0, hires: 0 }]]);
  let totalHires = 0;
  for (const v of vacancies) {
    for (const a of v.applications) {
      if (!a.submittedDate) continue;
      const entry = counts.get(counts.has(a.source) ? a.source : null);
      entry.applicants += 1;
      if (a.offer?.status === 'Accepted') { entry.hires += 1; totalHires += 1; }
    }
  }
  const rows = [...counts.entries()]
    .map(([key, c]) => ({ source: labelOf(key), applicants: c.applicants, hires: c.hires, shareOfHires: pct(c.hires, totalHires) }))
    .filter((r) => r.applicants > 0 || r.hires > 0)
    .sort((a, b) => b.hires - a.hires || b.applicants - a.applicants);
  const top = rows.find((r) => r.hires > 0 && r.source !== 'Not stated');
  return {
    key: 'sourceOfHire', label: 'Source of hire', value: top ? top.source : null, unit: '',
    summary: top ? `${top.hires} of ${totalHires} hire(s)` : 'no hires with a known source yet',
    formula: 'Where each candidate saw the advert (asked when they apply), counted for applicants and for hires (accepted offers).',
    source: 'Application.source, Offer.status',
    columns: [['source', 'Where they saw the advert'], ['applicants', 'Applicants'], ['hires', 'Hires'], ['shareOfHires', '% of hires']],
    rows
  };
}

// Has an application reached each stage? Each later stage implies the
// earlier ones (a rejection doesn't erase how far it got).
const SHORTLISTED = (a) => Boolean(a.shortlistApprovedAt || a.excoApprovalId) || ['Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered'].includes(a.status);
const INTERVIEWED = (a) => a.interviewRounds.some((r) => r.status === 'Completed');
const OFFERED = (a) => Boolean(a.offer?.approvedDate);
const HIRED = (a) => a.offer?.status === 'Accepted';
const STAGES = [
  ['Applied', () => true],
  ['Screened in', (a) => ['UnderReview', 'ShortlistProposed'].includes(a.status) || Boolean(a.shortlistProposedAt) || SHORTLISTED(a) || INTERVIEWED(a) || OFFERED(a)],
  ['Shortlisted', (a) => SHORTLISTED(a) || INTERVIEWED(a) || OFFERED(a)],
  ['Interviewed', (a) => INTERVIEWED(a) || OFFERED(a)],
  ['Offered', OFFERED],
  ['Hired', HIRED]
];

function pipelineHealth(vacancies) {
  const apps = vacancies.flatMap((v) => v.applications.filter((a) => a.submittedDate));
  const reached = STAGES.map(([, test]) => apps.filter(test).length);
  const rows = STAGES.map(([stage], i) => ({
    stage, reached: reached[i],
    fromPrevious: i === 0 ? null : pct(reached[i], reached[i - 1]),
    droppedHere: i === STAGES.length - 1 ? null : reached[i] - reached[i + 1]
  }));
  const open = apps.filter((a) => !['Rejected', 'Withdrawn'].includes(a.status) && a.offer?.status !== 'Accepted').length;
  return {
    key: 'pipelineHealth', label: 'Pipeline health', value: pct(reached[reached.length - 1], reached[0]), unit: '% hired',
    summary: `${reached[0]} applied, ${open} still in progress`,
    formula: 'How many applications reached each stage, the share of the previous stage that went on, and how many went no further (rejected, withdrawn, or still in progress).',
    source: 'Application.status, shortlist and EXCO approval, InterviewRound.status, Offer',
    columns: [['stage', 'Stage'], ['reached', 'Reached'], ['fromPrevious', '% of previous stage'], ['droppedHere', 'Went no further']],
    rows
  };
}

function applicantsPerPosition(vacancies) {
  const rows = vacancies.filter((v) => v.approvedAt).map((v) => {
    const applicants = v.applications.filter((a) => a.submittedDate).length;
    return { jobRef: v.jobRef, title: v.title, department: v.department?.name, positions: v.positionsRequired, applicants, perPosition: round1(applicants / Math.max(1, v.positionsRequired)) };
  });
  const positions = rows.reduce((n, r) => n + r.positions, 0);
  const applicants = rows.reduce((n, r) => n + r.applicants, 0);
  return {
    key: 'applicantsPerPosition', label: 'Applicants per position', value: positions ? round1(applicants / positions) : null, unit: 'per post',
    summary: `${applicants} applicant(s) for ${positions} post(s) on ${rows.length} published vacancy(ies)`,
    formula: 'Submitted applications divided by the posts advertised (positions required), over published vacancies.',
    source: 'Application.submittedDate, Vacancy.positionsRequired',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['department', 'Department'], ['positions', 'Posts'], ['applicants', 'Applicants'], ['perPosition', 'Per post']],
    rows
  };
}

function selectionRatio(vacancies) {
  const rows = vacancies.map((v) => {
    const applicants = v.applications.filter((a) => a.submittedDate).length;
    const hires = v.applications.filter((a) => a.offer?.status === 'Accepted').length;
    return { jobRef: v.jobRef, title: v.title, applicants, hires, ratio: pct(hires, applicants) };
  }).filter((r) => r.applicants > 0);
  const applicants = rows.reduce((n, r) => n + r.applicants, 0);
  const hires = rows.reduce((n, r) => n + r.hires, 0);
  return {
    key: 'selectionRatio', label: 'Selection ratio', value: pct(hires, applicants), unit: '%',
    summary: `${hires} hired of ${applicants} applicant(s)`,
    formula: 'Candidates hired (accepted offers) divided by everyone who applied.',
    source: 'Offer.status, Application.submittedDate',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['applicants', 'Applicants'], ['hires', 'Hired'], ['ratio', '% hired']],
    rows
  };
}

async function openPositions(f, excludeVacancyIds) {
  const positions = await prisma.position.findMany({
    where: {
      ...(f.positionId ? { id: f.positionId } : {}),
      ...(f.level ? { level: f.level } : {}),
      department: { status: 'Approved', ...(f.departmentId ? { id: f.departmentId } : {}), ...(f.directorateId ? { directorateId: f.directorateId } : {}) }
    },
    select: {
      headcount: true, occupied: true, department: { select: { id: true, name: true, directorate: { select: { name: true } } } },
      vacancies: {
        where: {
          status: { in: ['Open', 'PartiallyFilled'] }, ...(f.postingType ? { postingType: f.postingType } : {}),
          ...(f.location ? { location: { contains: f.location } } : {}), ...(excludeVacancyIds.length ? { id: { notIn: excludeVacancyIds } } : {})
        },
        select: { positionsRequired: true, _count: { select: { hires: true } } }
      }
    }
  });
  const byDept = new Map();
  for (const p of positions) {
    const d = byDept.get(p.department.id) || { department: p.department.name, directorate: p.department.directorate?.name, headcount: 0, filled: 0, counted: 0, beingRecruited: 0 };
    if (p.headcount != null) { d.headcount += p.headcount; d.filled += Math.min(p.occupied, p.headcount); d.counted += 1; }
    d.beingRecruited += p.vacancies.reduce((n, v) => n + Math.max(0, v.positionsRequired - v._count.hires), 0);
    byDept.set(p.department.id, d);
  }
  const rows = [...byDept.values()]
    .filter((d) => d.counted > 0 || d.beingRecruited > 0)
    .map((d) => ({ ...d, vacant: d.counted ? d.headcount - d.filled : null, openRate: d.counted ? pct(d.headcount - d.filled, d.headcount) : null }))
    .sort((a, b) => (b.openRate ?? -1) - (a.openRate ?? -1));
  const headcount = rows.reduce((n, r) => n + (r.counted ? r.headcount : 0), 0);
  const filled = rows.reduce((n, r) => n + (r.counted ? r.filled : 0), 0);
  return {
    key: 'openPositions', label: '% of open positions', value: pct(headcount - filled, headcount), unit: '%',
    summary: headcount ? `${headcount - filled} of ${headcount} approved post(s) vacant; ${rows.reduce((n, r) => n + r.beingRecruited, 0)} being recruited` : 'no approved headcount recorded yet (Departments screen)',
    formula: 'Vacant posts (approved headcount less posts filled) as a share of the approved headcount, by department and organisation-wide - where a headcount is recorded. Also the posts being recruited for on open vacancies. Today\'s position, so the date range does not apply.',
    source: 'Position.headcount, Position.occupied, open Vacancy.positionsRequired less hires',
    columns: [['directorate', 'Directorate'], ['department', 'Department'], ['headcount', 'Approved posts'], ['filled', 'Filled'], ['vacant', 'Vacant'], ['openRate', '% open'], ['beingRecruited', 'Being recruited']],
    rows: rows.map(({ counted, ...r }) => r)
  };
}

async function completionRate(vacancies) {
  const ids = vacancies.map((v) => v.id);
  const [started, submitted] = ids.length ? await Promise.all([
    prisma.application.groupBy({ by: ['vacancyId'], where: { vacancyId: { in: ids } }, _count: { _all: true } }),
    prisma.application.groupBy({ by: ['vacancyId'], where: { vacancyId: { in: ids }, submittedDate: { not: null } }, _count: { _all: true } })
  ]) : [[], []];
  const count = (list, id) => list.find((x) => x.vacancyId === id)?._count._all || 0;
  const rows = vacancies.map((v) => ({ jobRef: v.jobRef, title: v.title, started: count(started, v.id), submitted: count(submitted, v.id) }))
    .filter((r) => r.started > 0).map((r) => ({ ...r, rate: pct(r.submitted, r.started) }));
  const s = rows.reduce((n, r) => n + r.started, 0);
  const sub = rows.reduce((n, r) => n + r.submitted, 0);
  return {
    key: 'completionRate', label: 'Application completion rate', value: pct(sub, s), unit: '%',
    summary: `${sub} submitted of ${s} started`,
    formula: 'Applications submitted divided by applications started (drafts included; a draft the candidate deleted is not counted).',
    source: 'Application rows, Application.submittedDate',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['started', 'Started'], ['submitted', 'Submitted'], ['rate', '% completed']],
    rows
  };
}

async function requisitionAging(f, excludeVacancyIds, now) {
  const waiting = await prisma.vacancy.findMany({
    where: { ...orgWhere(f), status: { in: ['PendingApproval', 'Returned'] }, ...(excludeVacancyIds.length ? { id: { notIn: excludeVacancyIds } } : {}) },
    select: { jobRef: true, title: true, status: true, createdAt: true, approvalRequestedAt: true, returnedAt: true, department: { select: { name: true } } }
  });
  const rows = waiting.map((v) => {
    const since = v.status === 'Returned' ? v.returnedAt || v.createdAt : v.approvalRequestedAt || v.createdAt;
    return { jobRef: v.jobRef, title: v.title, department: v.department?.name, status: v.status === 'Returned' ? 'With HR (returned)' : 'Waiting for approval', since: isoDay(since), days: round1(days(since, now)) };
  }).sort((a, b) => b.days - a.days);
  return {
    key: 'requisitionAging', label: 'Requisition aging', value: avg(rows.map((r) => r.days)), unit: 'days',
    summary: rows.length ? `${rows.length} vacancy(ies) not yet approved; oldest ${rows[0].days} days` : 'nothing waiting',
    formula: 'For each vacancy not yet approved: days since it was sent for approval (or returned to HR). Today\'s position, so the date range does not apply.',
    source: 'Vacancy.approvalRequestedAt, Vacancy.returnedAt, Vacancy.createdAt',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['department', 'Department'], ['status', 'Where it is'], ['since', 'Since'], ['days', 'Days']],
    rows
  };
}

function approvalTurnaround(vacancies) {
  const rows = vacancies.filter((v) => v.approvedAt).map((v) => ({ jobRef: v.jobRef, title: v.title, raised: isoDay(v.createdAt), approved: isoDay(v.approvedAt), days: round1(days(v.createdAt, v.approvedAt)) }));
  const list = rows.map((r) => r.days);
  return {
    key: 'approvalTurnaround', label: 'Approval turnaround', value: avg(list), unit: 'days',
    summary: list.length ? `${list.length} vacancy(ies) approved; median ${median(list)} days` : 'none approved yet',
    formula: 'Days from a vacancy being raised to its approval (returns for revision included).',
    source: 'Vacancy.createdAt, Vacancy.approvedAt',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['raised', 'Raised'], ['approved', 'Approved'], ['days', 'Days']],
    rows
  };
}

function bottlenecks(vacancies) {
  const spans = {
    'Raised to approved': [], 'Approved to applications closing': [], 'Applications closed to shortlist approved': [],
    'Shortlist approved to EXCO approval': [], 'EXCO approval to first interview': [], 'First interview to merit list approved': [],
    'Merit list approved to offer accepted': []
  };
  const push = (k, from, to) => { const d = days(from, to); if (d != null && d >= 0) spans[k].push(d); };
  for (const v of vacancies) {
    const a = v.applications;
    const shortlist = minDate(a.map((x) => x.shortlistApprovedAt));
    const exco = minDate(v.excoShortlistApprovals.map((e) => e.approvedOn || e.uploadedAt));
    const interview = minDate(a.flatMap((x) => x.interviewRounds.filter((r) => r.status !== 'Cancelled').map((r) => r.scheduledDate)));
    const merit = minDate(a.map((x) => x.meritApprovedAt));
    const accepted = minDate(a.filter((x) => x.offer?.status === 'Accepted').map((x) => x.offer.decidedAt));
    push('Raised to approved', v.createdAt, v.approvedAt);
    push('Approved to applications closing', v.approvedAt, v.deadline);
    push('Applications closed to shortlist approved', v.deadline, shortlist);
    push('Shortlist approved to EXCO approval', shortlist, exco);
    push('EXCO approval to first interview', exco, interview);
    push('First interview to merit list approved', interview, merit);
    push('Merit list approved to offer accepted', merit, accepted);
  }
  const rows = Object.entries(spans).map(([stage, list]) => ({ stage, vacancies: list.length, averageDays: avg(list), longestDays: list.length ? round1(Math.max(...list)) : null }));
  const slowest = rows.filter((r) => r.averageDays != null && r.stage !== 'Approved to applications closing').sort((a, b) => b.averageDays - a.averageDays)[0];
  return {
    key: 'bottlenecks', label: 'Bottlenecks', value: slowest ? slowest.stage : null, unit: '',
    summary: slowest ? `slowest step: ${slowest.averageDays} days on average` : 'not enough history yet',
    formula: 'Average days each step takes, per vacancy, from the first time the step happened (the advertising period is shown but not counted as a bottleneck).',
    source: 'Vacancy dates, Application shortlist and merit approvals, EXCO approvals, InterviewRound.scheduledDate, Offer.decidedAt',
    columns: [['stage', 'Step'], ['vacancies', 'Vacancies'], ['averageDays', 'Average days'], ['longestDays', 'Longest']],
    rows
  };
}

function committeeParticipation(vacancies) {
  const rows = vacancies.filter((v) => v.shortlistExercise && v.shortlistExercise.status !== 'Setup').map((v) => {
    const members = v.shortlistExercise.members;
    const criteria = Array.isArray(v.shortlistExercise.criteria) ? v.shortlistExercise.criteria.length : 0;
    const assignments = members.flatMap((m) => m.assignments).filter((x) => !x.conflictAt);
    const complete = assignments.filter((x) => criteria > 0 && x._count.ratings >= criteria).length;
    return {
      jobRef: v.jobRef, title: v.title, members: members.length, submitted: members.filter((m) => m.submittedAt).length,
      assignments: assignments.length, rated: complete, completion: pct(complete, assignments.length)
    };
  });
  const members = rows.reduce((n, r) => n + r.members, 0);
  const submitted = rows.reduce((n, r) => n + r.submitted, 0);
  return {
    key: 'committeeParticipation', label: 'Committee participation', value: pct(submitted, members), unit: '% submitted',
    summary: `${submitted} of ${members} member(s) submitted; ${rows.reduce((n, r) => n + r.rated, 0)} of ${rows.reduce((n, r) => n + r.assignments, 0)} applicant ratings complete`,
    formula: 'Shortlisting committee members who submitted their ratings, and applicants fully rated (every criterion) out of those assigned, leaving out stand-downs.',
    source: 'ShortlistMember.submittedAt, ShortlistAssignment, ShortlistRating',
    columns: [['jobRef', 'Job ref'], ['title', 'Job'], ['members', 'Members'], ['submitted', 'Submitted'], ['assignments', 'Applicants assigned'], ['rated', 'Fully rated'], ['completion', '% rated']],
    rows
  };
}

function offerOutcomes(vacancies) {
  const counts = { Accepted: 0, Declined: 0, Expired: 0, Withdrawn: 0, Waiting: 0 };
  for (const v of vacancies) {
    for (const a of v.applications) {
      if (!a.offer?.approvedDate) continue;
      if (counts[a.offer.status] !== undefined) counts[a.offer.status] += 1;
      else if (a.offer.status === 'Approved') counts.Waiting += 1;
    }
  }
  const decided = counts.Accepted + counts.Declined + counts.Expired;
  return {
    key: 'offerOutcomes', label: 'Offer acceptance rate', value: pct(counts.Accepted, decided), unit: '%',
    summary: `${counts.Accepted} accepted, ${counts.Declined} declined, ${counts.Expired} lapsed${counts.Waiting ? `, ${counts.Waiting} waiting` : ''}`,
    formula: 'Offers accepted divided by offers the candidate answered or let lapse (issued offers only; withdrawn ones are left out).',
    source: 'Offer.status, Offer.approvedDate',
    columns: [['outcome', 'Outcome'], ['offers', 'Offers']],
    rows: Object.entries(counts).map(([outcome, offers]) => ({ outcome, offers }))
  };
}

/** Every metric for the filters, in the dashboard's order. */
async function compute(query, excludeVacancyIds = [], now = new Date()) {
  const f = parseFilters(query);
  const vacancies = await load(f, excludeVacancyIds);
  const metrics = [
    timeToHire(vacancies), sourceOfHire(vacancies), pipelineHealth(vacancies), applicantsPerPosition(vacancies), selectionRatio(vacancies),
    await openPositions(f, excludeVacancyIds), await completionRate(vacancies),
    await requisitionAging(f, excludeVacancyIds, now), approvalTurnaround(vacancies), bottlenecks(vacancies),
    committeeParticipation(vacancies), offerOutcomes(vacancies)
  ].map((m) => ({ ...m, refresh: REFRESH, columns: m.columns.map(([key, label]) => ({ key, label })) }));
  return {
    generatedAt: now, vacancies: vacancies.length,
    filters: { ...query },
    metrics
  };
}

module.exports = { compute, parseFilters, STAGES };
