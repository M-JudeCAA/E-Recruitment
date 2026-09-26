const dashboardModel = require('../models/dashboardModel');

const ALLOWED_MONTHS = [3, 6, 12];
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function resolveMonths(req) {
  return ALLOWED_MONTHS.includes(Number(req.query.months)) ? Number(req.query.months) : 6;
}

// UTC 'YYYY-MM' - same UTC-everywhere reasoning as dashboardController's
// dayKey/startOfUtcWindow, just at month granularity.
function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// The last `n` month keys, oldest first, ending at the current month - the
// zero-filled x-axis for every trend below (a month with no resolved
// tasks/decided offers/fills should render as a real zero, not a gap).
function lastNMonthKeys(n) {
  const now = new Date();
  const keys = [];
  for (let i = n - 1; i >= 0; i--) {
    keys.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  }
  return keys;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Every resolved (approved, or in Department's case approved-or-rejected)
// task across the three SLA-tracked queues, unified into one shape and
// annotated with whether it ever escalated - the shared source both
// slaCompliance and approvalTurnaround aggregate differently. A task
// missing its `since` timestamp (the same edge case slaStatusService.js
// guards against - e.g. an Offer recommended before recommendedDate
// existed) is dropped rather than producing a nonsensical duration.
async function getResolvedTasks() {
  const [vacancies, departments, offers, escalatedKeys] = await Promise.all([
    dashboardModel.resolvedVacancyApprovals(),
    dashboardModel.resolvedDepartmentApprovals(),
    dashboardModel.resolvedOfferApprovals(),
    dashboardModel.allEscalatedTaskKeys()
  ]);
  const escalatedSet = new Set(escalatedKeys.map((e) => `${e.taskType}:${e.taskId}`));

  const tasks = [
    ...vacancies.map((v) => ({
      taskType: 'VacancyApproval', taskId: v.id, since: v.createdAt, resolvedAt: v.approvedAt,
      approverName: v.approvedBy?.name || 'Unknown'
    })),
    ...departments.map((d) => ({
      taskType: 'DepartmentApproval', taskId: d.id, since: d.createdAt, resolvedAt: d.approvedAt,
      approverName: d.approvedBy?.name || 'Unknown'
    })),
    ...offers.map((o) => ({
      taskType: 'OfferApproval', taskId: o.id, since: o.recommendedDate, resolvedAt: o.approvedDate,
      approverName: o.approvedBy?.name || 'Unknown'
    }))
  ];

  return tasks
    .filter((t) => t.since && t.resolvedAt)
    .map((t) => ({ ...t, escalated: escalatedSet.has(`${t.taskType}:${t.taskId}`) }));
}

// % of resolved tasks decided without ever escalating past their first SLA
// tier, per month - the historical counterpart to the Follow-ups panel's
// live "what's open right now" view.
async function slaCompliance(req, res) {
  const months = resolveMonths(req);
  const tasks = await getResolvedTasks();
  const monthKeys = lastNMonthKeys(months);

  const buckets = new Map(monthKeys.map((k) => [k, { compliant: 0, breached: 0 }]));
  for (const task of tasks) {
    const bucket = buckets.get(monthKey(task.resolvedAt));
    if (!bucket) continue;
    bucket[task.escalated ? 'breached' : 'compliant']++;
  }

  res.json(monthKeys.map((month) => {
    const { compliant, breached } = buckets.get(month);
    const total = compliant + breached;
    return { month, compliant, breached, complianceRate: total > 0 ? Math.round((compliant / total) * 100) : null };
  }));
}

// Average turnaround (since -> resolvedAt) per approver, worst-first - not
// month-bucketed (per-approver is the useful cut here; approvers are few
// enough that a full trend-by-approver would be noise, not signal).
async function approvalTurnaround(req, res) {
  const tasks = await getResolvedTasks();

  const byApprover = new Map();
  for (const task of tasks) {
    const hours = (new Date(task.resolvedAt) - new Date(task.since)) / MS_PER_HOUR;
    const entry = byApprover.get(task.approverName) || { approver: task.approverName, count: 0, totalHours: 0 };
    entry.count += 1;
    entry.totalHours += hours;
    byApprover.set(task.approverName, entry);
  }

  res.json(Array.from(byApprover.values())
    .map((e) => ({ approver: e.approver, count: e.count, avgHours: round1(e.totalHours / e.count) }))
    .sort((a, b) => b.avgHours - a.avgHours));
}

// Accept/decline split per month, from Offer.decidedAt - see that field's
// schema comment for why approvedDate (a different, earlier event) can't
// stand in for this.
async function offerOutcomes(req, res) {
  const months = resolveMonths(req);
  const offers = await dashboardModel.decidedOffers();
  const monthKeys = lastNMonthKeys(months);

  const buckets = new Map(monthKeys.map((k) => [k, { Accepted: 0, Declined: 0 }]));
  for (const offer of offers) {
    const bucket = buckets.get(monthKey(offer.decidedAt));
    if (bucket && (offer.status === 'Accepted' || offer.status === 'Declined')) bucket[offer.status]++;
  }

  res.json(monthKeys.map((month) => {
    const { Accepted, Declined } = buckets.get(month);
    const total = Accepted + Declined;
    return { month, Accepted, Declined, acceptanceRate: total > 0 ? Math.round((Accepted / total) * 100) : null };
  }));
}

// Internal vs External among vacancies that have ever reached Filled, per
// month of first fill.
async function hiringMix(req, res) {
  const months = resolveMonths(req);
  const vacancies = await dashboardModel.filledVacancies();
  const monthKeys = lastNMonthKeys(months);

  const buckets = new Map(monthKeys.map((k) => [k, { Internal: 0, External: 0 }]));
  for (const v of vacancies) {
    const bucket = buckets.get(monthKey(v.filledAt));
    if (bucket) bucket[v.postingType]++;
  }

  res.json(monthKeys.map((month) => ({ month, ...buckets.get(month) })));
}

// Days from a vacancy going live (approvedAt) to first Filled - an
// org-wide current average plus a monthly trend, both from the same
// filledVacancies() fetch.
async function timeToFill(req, res) {
  const months = resolveMonths(req);
  const vacancies = await dashboardModel.filledVacancies();
  const withDays = vacancies
    .filter((v) => v.approvedAt)
    .map((v) => ({ filledAt: v.filledAt, days: (new Date(v.filledAt) - new Date(v.approvedAt)) / MS_PER_DAY }));

  const overallAvgDays = withDays.length > 0
    ? round1(withDays.reduce((sum, v) => sum + v.days, 0) / withDays.length)
    : null;

  const monthKeys = lastNMonthKeys(months);
  const buckets = new Map(monthKeys.map((k) => [k, []]));
  for (const v of withDays) {
    const bucket = buckets.get(monthKey(v.filledAt));
    if (bucket) bucket.push(v.days);
  }

  const trend = monthKeys.map((month) => {
    const days = buckets.get(month);
    return { month, avgDays: days.length > 0 ? round1(days.reduce((s, d) => s + d, 0) / days.length) : null, count: days.length };
  });

  res.json({ overallAvgDays, filledCount: withDays.length, trend });
}

// Most recent delegated actions - "is delegation being relied on too
// heavily" is a judgment call for a Manager/Director to make by looking at
// the raw log, not something this collapses into a single verdict.
async function delegationActivity(req, res) {
  const take = Math.min(Number(req.query.limit) || 20, 100);
  const rows = await dashboardModel.recentDelegationUsage(take);
  res.json(rows.map((r) => ({
    id: r.id, action: r.action, usedAt: r.usedAt,
    delegatorName: r.delegation.delegator.name, delegateName: r.delegation.delegate.name
  })));
}

// One row per panelist (grouped by name, not staffUserId - PanelMember's
// own schema comment: an external panelist commonly has no system
// account) - rounds scored and average score given, sorted by volume.
async function panelWorkload(req, res) {
  const rows = await dashboardModel.scoredPanelMembers();

  const byName = new Map();
  for (const row of rows) {
    const entry = byName.get(row.name) || { name: row.name, count: 0, totalScore: 0 };
    entry.count += 1;
    entry.totalScore += row.score;
    byName.set(row.name, entry);
  }

  res.json(Array.from(byName.values())
    .map((e) => ({ name: e.name, roundsScored: e.count, avgScore: round1(e.totalScore / e.count) }))
    .sort((a, b) => b.roundsScored - a.roundsScored));
}

module.exports = { slaCompliance, approvalTurnaround, offerOutcomes, hiringMix, timeToFill, delegationActivity, panelWorkload };
