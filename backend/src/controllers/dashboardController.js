const dashboardModel = require('../models/dashboardModel');
const slaModel = require('../models/slaModel');
const { getPendingTasksWithStatus } = require('../services/slaStatusService');

// Executive summary KPIs for the Manager/Director landing dashboard - one
// round trip in place of the several per-status client-side filters
// HRHome does today, plus the two figures (pending departments, offers
// pending approval) nothing on the frontend currently fetches at all.
async function summary(req, res) {
  const [vacancyPairs, applicationPairs, offerPairs, pendingDepartments, offersPendingApproval] = await Promise.all([
    dashboardModel.countVacanciesByStatus(),
    dashboardModel.countApplicationsByStatus(),
    dashboardModel.countOffersByStatus(),
    dashboardModel.countPendingDepartments(),
    dashboardModel.countOffersPendingApproval()
  ]);

  res.json({
    vacanciesByStatus: Object.fromEntries(vacancyPairs),
    applicationsByStatus: Object.fromEntries(applicationPairs),
    // ADDED - offer outcomes by status, for the funnel/donut charts. Additive
    // only: every field the old response shape had is still there unchanged.
    offersByStatus: Object.fromEntries(offerPairs),
    pendingDepartments,
    offersPendingApproval
  });
}

const ALLOWED_TREND_DAYS = [7, 30, 90];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// UTC 'YYYY-MM-DD' for a date - the shared key between bucket boundaries
// and stored timestamps. Bucketing entirely in UTC (both here and in
// startOfUtcWindow below) rather than mixing local-time boundaries
// (setHours/setDate) with UTC-based keys avoids an off-by-one bucket
// whenever the server isn't running in UTC.
function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Midnight UTC, `days` ago from today - both the start of the query window
// (`since`, passed to the model) and the first bucket's boundary, so the
// two can never disagree about which day a borderline row belongs to.
function startOfUtcWindow(days) {
  const todayUtc = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
  return new Date(todayUtc.getTime() - (days - 1) * MS_PER_DAY);
}

// Zero-fills every day in the window (not just days that had activity) so
// the trend chart's x-axis is continuous - a silent day should render as a
// visible dip, not a gap. `dates` may contain nulls (a row whose date field
// isn't set yet); those are simply skipped rather than crashing on `new Date(null)`.
function bucketByDay(dates, days) {
  const start = startOfUtcWindow(days);

  const counts = new Map();
  for (let i = 0; i < days; i++) {
    counts.set(dayKey(new Date(start.getTime() + i * MS_PER_DAY)), 0);
  }
  for (const date of dates) {
    if (!date) continue;
    const key = dayKey(date);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return Array.from(counts, ([date, count]) => ({ date, count }));
}

// Three parallel day-bucketed series behind the executive Trend panel -
// applications submitted, vacancies approved, offers approved - over a
// caller-chosen window (defaults/falls back to 30 days for anything not in
// the supported set, rather than erroring on a stray query param).
async function trends(req, res) {
  const days = ALLOWED_TREND_DAYS.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = startOfUtcWindow(days);

  const [applications, vacancies, offers] = await Promise.all([
    dashboardModel.applicationsCreatedSince(since),
    dashboardModel.vacanciesApprovedSince(since),
    dashboardModel.offersApprovedSince(since)
  ]);

  res.json({
    days,
    applicationsSubmitted: bucketByDay(applications.map((a) => a.createdAt), days),
    vacanciesApproved: bucketByDay(vacancies.map((v) => v.approvedAt), days),
    offersApproved: bucketByDay(offers.map((o) => o.approvedDate), days)
  });
}

// Every open VacancyApproval/DepartmentApproval/OfferApproval task
// (ApprovalsCenter.jsx's own three queues), annotated with SLA due/overdue
// status - see slaStatusService.js. Open to every HR tier, not just
// Manager+, since the underlying queues are already org-wide visibility on
// ApprovalsCenter; only the approve/reject actions themselves are tier-gated.
async function followUps(req, res) {
  const tasks = await getPendingTasksWithStatus();
  res.json(tasks);
}

// Raw SLA policy durations so the UI can show "SLA: 48h" instead of
// hardcoding a number that would silently drift from what's actually
// configured (see scripts/seedSlaPolicies.js).
async function slaPolicies(req, res) {
  const policies = await slaModel.listPolicies();
  res.json(policies);
}

// Merges four independently-timestamped event kinds (vacancy approval,
// posting-type transition, offer approval, department approval) into one
// reverse-chronological feed. Each kind is fetched capped at `take` and
// re-sliced after merging, since the true most-recent N could be any mix
// of the four.
async function activity(req, res) {
  const take = 10;
  const [vacancies, transitions, offers, departments] = await Promise.all([
    dashboardModel.recentApprovedVacancies(take),
    dashboardModel.recentPostingTypeTransitions(take),
    dashboardModel.recentApprovedOffers(take),
    dashboardModel.recentApprovedDepartments(take)
  ]);

  const items = [
    ...vacancies.map((v) => ({
      type: 'VacancyApproved',
      at: v.approvedAt,
      actor: v.approvedBy?.name || null,
      role: v.approvedByRole,
      text: `approved vacancy ${v.jobRef} — ${v.title}`
    })),
    ...transitions.map((v) => ({
      type: 'PostingTypeTransition',
      at: v.postingTypeChangedAt,
      actor: v.postingTypeChangedBy?.name || null,
      text: `transitioned ${v.jobRef} — ${v.title} from ${v.postingTypePreviousValue} to ${v.postingType}`
    })),
    ...offers.map((o) => ({
      type: 'OfferApproved',
      at: o.approvedDate,
      actor: o.approvedBy?.name || null,
      text: `approved an offer for ${o.application.candidate.fullName} — ${o.application.vacancy.title}`
    })),
    ...departments.map((d) => ({
      type: 'DepartmentApproved',
      at: d.approvedAt,
      actor: d.approvedBy?.name || null,
      text: `approved department ${d.name} (${d.directorate.name})`
    }))
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, take);

  res.json(items);
}

// Positions required, grouped by directorate then by vacancy status - the
// executive headcount-by-directorate widget. Grouped client-side (not via
// Prisma groupBy) since the grouping key lives two relations away
// (Vacancy -> Department -> Directorate).
async function headcountByDirectorate(req, res) {
  const vacancies = await dashboardModel.vacanciesForHeadcount();

  const byDirectorate = {};
  for (const v of vacancies) {
    // department/directorate are non-nullable FKs on Vacancy/Department -
    // always present, never defensively coded around.
    const name = v.department.directorate.name;
    if (!byDirectorate[name]) {
      byDirectorate[name] = { directorate: name, Open: 0, PartiallyFilled: 0, Filled: 0, totalPositions: 0 };
    }
    byDirectorate[name][v.status] += v.positionsRequired;
    byDirectorate[name].totalPositions += v.positionsRequired;
  }

  const result = Object.values(byDirectorate).sort((a, b) => b.totalPositions - a.totalPositions);
  res.json(result);
}

// Interview rounds scheduled in the next `days` (default/fallback 7) -
// HRHome's "Upcoming interviews" panel. Available to every HR tier, same
// reasoning as followUps: this is everyday operational visibility, not an
// approval action.
async function upcomingInterviews(req, res) {
  const parsedDays = Number(req.query.days);
  const days = Number.isInteger(parsedDays) && parsedDays > 0 ? parsedDays : 7;
  const from = new Date();
  const to = new Date(from.getTime() + days * MS_PER_DAY);

  const rounds = await dashboardModel.interviewRoundsScheduledBetween(from, to);
  res.json(rounds.map((r) => ({
    id: r.id, scheduledDate: r.scheduledDate, mode: r.mode, roundNumber: r.roundNumber,
    candidateName: r.application.candidate.fullName,
    vacancyId: r.application.vacancy.id, vacancyTitle: r.application.vacancy.title, jobRef: r.application.vacancy.jobRef
  })));
}

// Keyword-categorized breakdown of why screened applications failed -
// screeningReasons is a JSON-stringified free-text array (see
// screeningService.screenApplication's `reasons`), built from a fixed set
// of message templates, so matching a lowercased substring per category is
// reliable without needing a second, more structured field on Application.
const SCREENING_CATEGORIES = [
  { key: 'education', label: 'Education', match: (r) => r.includes('education') },
  { key: 'experience', label: 'Experience', match: (r) => r.includes('experience') },
  { key: 'age', label: 'Age', match: (r) => r.includes('age') },
  { key: 'flyingHours', label: 'Flying hours', match: (r) => r.includes('flying hours') },
  { key: 'cgpa', label: 'CGPA', match: (r) => r.includes('cgpa') },
  { key: 'examGrade', label: 'Exam grade', match: (r) => r.includes('grade') },
  { key: 'disqualifying', label: 'Disqualifying requirement', match: (r) => r.includes('disqualifying') },
  { key: 'referees', label: 'Referees', match: (r) => r.includes('referee') },
  { key: 'missingRecords', label: 'Missing records', match: (r) => r.includes('no education record') || r.includes('no work experience record') }
];

async function screeningBreakdown(req, res) {
  const [counts, failures] = await Promise.all([
    dashboardModel.countApplicationsByScreeningOutcome(),
    dashboardModel.screeningFailureReasons()
  ]);

  const categoryCounts = SCREENING_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: 0 }));
  for (const failure of failures) {
    let reasons;
    try {
      reasons = JSON.parse(failure.screeningReasons || '[]');
    } catch {
      reasons = [];
    }
    for (const reason of reasons) {
      const lower = String(reason).toLowerCase();
      const category = SCREENING_CATEGORIES.find((c) => c.match(lower));
      if (category) categoryCounts.find((c) => c.key === category.key).count++;
    }
  }

  res.json({
    ...Object.fromEntries(counts),
    topReasons: categoryCounts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)
  });
}

module.exports = {
  summary, activity, headcountByDirectorate, trends, followUps, slaPolicies,
  upcomingInterviews, screeningBreakdown
};
