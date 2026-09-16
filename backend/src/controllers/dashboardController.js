const dashboardModel = require('../models/dashboardModel');

// Executive summary KPIs for the Manager/Director landing dashboard - one
// round trip in place of the several per-status client-side filters
// HRHome does today, plus the two figures (pending departments, offers
// pending approval) nothing on the frontend currently fetches at all.
async function summary(req, res) {
  const [vacancyPairs, applicationPairs, pendingDepartments, offersPendingApproval] = await Promise.all([
    dashboardModel.countVacanciesByStatus(),
    dashboardModel.countApplicationsByStatus(),
    dashboardModel.countPendingDepartments(),
    dashboardModel.countOffersPendingApproval()
  ]);

  res.json({
    vacanciesByStatus: Object.fromEntries(vacancyPairs),
    applicationsByStatus: Object.fromEntries(applicationPairs),
    pendingDepartments,
    offersPendingApproval
  });
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

module.exports = { summary, activity, headcountByDirectorate };
