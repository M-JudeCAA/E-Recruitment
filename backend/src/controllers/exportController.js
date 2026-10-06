const exportService = require('../services/exportService');
const audit = require('../services/auditService');
const accessLog = require('../services/accessLogService');
const { sendCsv, toCsv } = require('../utils/csv');
const prisma = require('../config/db');
const offerService = require('../services/offerService');
const conflictOfInterest = require('../services/conflictOfInterestService');
const { sendError } = require('../utils/errorResponse');

// CSV downloads for a vacancy (FR-ATS-053). Taking candidate data out of
// the system is itself recorded in the vacancy's history (FR-ATS-081).

function vacancyIdFrom(req, res) {
  const vacancyId = Number(req.params.id ?? req.params.vacancyId);
  if (!Number.isInteger(vacancyId) || vacancyId <= 0) {
    res.status(400).json({ error: 'Invalid vacancy id' });
    return null;
  }
  return vacancyId;
}

function exporter(build, action) {
  return async (req, res) => {
    const vacancyId = vacancyIdFrom(req, res);
    if (!vacancyId) return;
    let report;
    try {
      report = await build(vacancyId);
    } catch (err) {
      return sendError(res, err);
    }
    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action, actor: audit.actorFrom(req), details: { rows: report.count }
    });
    await accessLog.record(req, { action, vacancyId, candidateIds: report.candidateIds || [] });
    sendCsv(res, report.filename, report.csv);
  };
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const MAX_ROWS = 5000;

// Offers & hires (Offers & hires page): every offer across the vacancies the
// viewer may work on, or one status (?status=, ?expiringSoon=true), as on
// screen. Each export is in the access log with the candidates it carried.
const OFFER_STATUSES = ['Recommended', 'Returned', 'Approved', 'Accepted', 'Declined', 'Expired', 'Withdrawn'];
const OFFER_COLUMNS = [
  { header: 'Candidate', value: (o) => o.application.candidate.fullName },
  { header: 'Candidate type', value: (o) => o.application.candidate.candidateType },
  { header: 'Job reference', value: (o) => o.application.vacancy.jobRef },
  { header: 'Vacancy', value: (o) => o.application.vacancy.title },
  { header: 'Merit rank', value: (o) => o.application.meritRank },
  { header: 'Merit list', value: (o) => o.application.meritListStatus },
  { header: 'Offer status', value: (o) => o.status },
  { header: 'Salary', value: (o) => (o.salaryAmount == null ? '' : Number(o.salaryAmount)) },
  { header: 'Currency', value: (o) => o.salaryCurrency },
  { header: 'Per', value: (o) => (o.salaryPeriod === 'Annual' ? 'year' : 'month') },
  { header: 'Allowances', value: (o) => o.allowances },
  { header: 'Employment', value: (o) => o.employmentCategory },
  { header: 'Contract months', value: (o) => o.contractMonths },
  { header: 'Start date', value: (o) => day(o.startDate) },
  { header: 'Duty station', value: (o) => o.dutyStation },
  { header: 'Recommended', value: (o) => day(o.recommendedDate) },
  { header: 'Recommended by', value: (o) => o.recommendedBy?.name },
  { header: 'Issued', value: (o) => day(o.approvedDate) },
  { header: 'Issued by', value: (o) => o.approvedBy?.name },
  { header: 'Answer due', value: (o) => day(o.responseDeadline) },
  { header: 'Decided', value: (o) => day(o.decidedAt) },
  { header: 'Reason', value: (o) => o.returnReason || o.declineReason || o.withdrawalReason }
];

async function offers(req, res) {
  const { status, expiringSoon } = req.query;
  if (status && !OFFER_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status filter' });
  const excludeVacancyIds = await conflictOfInterest.conflictedVacancyIds(req);
  const { data } = await offerService.list({ status: status || undefined, expiringSoon: expiringSoon === 'true', skip: 0, take: MAX_ROWS, excludeVacancyIds });
  await accessLog.record(req, { action: 'Offers exported', candidateIds: [...new Set(data.map((o) => o.application.candidate.id))] });
  const which = status ? status.toLowerCase() : expiringSoon === 'true' ? 'answer-due' : 'all';
  sendCsv(res, `offers-${which}-${day(new Date())}.csv`, toCsv(OFFER_COLUMNS, data));
}

const HIRE_COLUMNS = [
  { header: 'Onboarding case', value: (h) => h.caseRef },
  { header: 'Candidate', value: (h) => h.application.candidate.fullName },
  { header: 'Job reference', value: (h) => h.application.vacancy.jobRef },
  { header: 'Vacancy', value: (h) => h.application.vacancy.title },
  { header: 'Hired', value: (h) => day(h.hiredAt) },
  { header: 'Hired by', value: (h) => h.hiredBy?.name },
  { header: 'HRIS hand-off', value: (h) => h.handoffStatus },
  { header: 'HRIS case', value: (h) => h.onboardingCaseId }
];

async function hires(req, res) {
  const excluded = await conflictOfInterest.conflictedVacancyIds(req);
  const rows = await prisma.hire.findMany({
    where: excluded.length ? { vacancyId: { notIn: excluded } } : {},
    orderBy: { hiredAt: 'desc' }, take: MAX_ROWS,
    select: {
      caseRef: true, hiredAt: true, handoffStatus: true, onboardingCaseId: true, candidateId: true,
      hiredBy: { select: { name: true } },
      application: { select: { candidate: { select: { fullName: true } }, vacancy: { select: { jobRef: true, title: true } } } }
    }
  });
  await accessLog.record(req, { action: 'Hires exported', candidateIds: [...new Set(rows.map((h) => h.candidateId))] });
  sendCsv(res, `hires-${day(new Date())}.csv`, toCsv(HIRE_COLUMNS, rows));
}

module.exports = {
  offers,
  hires,
  shortlistReport: exporter(exportService.shortlistReport, 'Shortlisting report exported'),
  meritList: exporter(exportService.meritListReport, 'Merit list exported')
};
