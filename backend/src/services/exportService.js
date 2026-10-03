const prisma = require('../config/db');
const meritList = require('./meritListService');
const { toCsv, fileSlug } = require('../utils/csv');
const { AppError } = require('../utils/errorResponse');

// The spreadsheet exports HR takes out of the system for a vacancy
// (FR-ATS-053): the shortlisting report - every applicant with how they
// screened, how the committee ranked them and where they stand - and the
// approved or proposed merit list. Built server-side from the same data
// the screens use, and always the whole vacancy, never one page of it.

function day(date) {
  return date ? new Date(date).toISOString().slice(0, 10) : '';
}

function reasonsText(json) {
  if (!json) return '';
  try {
    const list = typeof json === 'string' ? JSON.parse(json) : json;
    return Array.isArray(list) ? list.join('; ') : '';
  } catch (err) {
    return '';
  }
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
}

function screeningOutcome(app) {
  if (app.screeningPassed === true) return 'Meets';
  if (app.screeningPassed === false) return 'Does not meet';
  return 'Not screened';
}

const SHORTLIST_COLUMNS = [
  { header: 'Committee rank', value: (a) => a.committeeRank },
  { header: 'Committee band', value: (a) => a.committeeBand },
  { header: 'Committee score', value: (a) => round1(a.committeeScore) },
  { header: 'Committee agreement %', value: (a) => (a.committeeAgreement == null ? null : Math.round(a.committeeAgreement * 100)) },
  { header: 'Interview order', value: (a) => a.rank },
  { header: 'Candidate', value: (a) => a.candidate.fullName },
  { header: 'Internal / External', value: (a) => a.candidate.candidateType },
  { header: 'Email', value: (a) => a.candidate.email },
  { header: 'Phone', value: (a) => a.candidate.phone },
  { header: 'District of origin', value: (a) => a.candidate.districtOfOrigin },
  { header: 'Place of residence', value: (a) => a.candidate.location },
  { header: 'Status', value: (a) => a.status },
  { header: 'Submitted', value: (a) => day(a.submittedDate) },
  { header: 'Minimum requirements', value: screeningOutcome },
  { header: 'Screening notes', value: (a) => reasonsText(a.screeningReasons) },
  { header: 'Shortlist score', value: (a) => round1(a.shortlistScore) },
  { header: 'Shortlist approved', value: (a) => day(a.shortlistApprovedAt) },
  { header: 'Rejection reason', value: (a) => a.rejectionReason }
];

// Committee rank first where there is one, then the interview order, then
// the screening score - the order HR reads the pool in.
function compareForShortlist(a, b) {
  const by = (x, y) => (x == null ? (y == null ? 0 : 1) : (y == null ? -1 : x - y));
  return by(a.committeeRank, b.committeeRank) || by(a.rank, b.rank)
    || (b.shortlistScore ?? -Infinity) - (a.shortlistScore ?? -Infinity)
    || a.candidate.fullName.localeCompare(b.candidate.fullName);
}

async function loadVacancy(vacancyId) {
  const vacancy = await prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { id: true, jobRef: true, title: true } });
  if (!vacancy) throw new AppError('Vacancy not found', 404);
  return vacancy;
}

async function shortlistReport(vacancyId) {
  const vacancy = await loadVacancy(vacancyId);
  const applications = await prisma.application.findMany({
    where: { vacancyId, status: { not: 'Draft' } },
    include: {
      candidate: {
        select: { fullName: true, email: true, phone: true, candidateType: true, districtOfOrigin: true, location: true }
      }
    }
  });
  const rows = [...applications].sort(compareForShortlist);
  return {
    vacancy,
    count: rows.length,
    candidateIds: rows.map((a) => a.candidateId),
    filename: `shortlisting-report-${fileSlug(vacancy.jobRef)}.csv`,
    csv: toCsv(SHORTLIST_COLUMNS, rows)
  };
}

const MERIT_COLUMNS = [
  { header: 'Merit rank', value: (r) => r.meritRank },
  { header: 'List', value: (r) => r.meritListStatus },
  { header: 'Merit list status', value: (r) => r.meritStatus },
  { header: 'Candidate', value: (r) => r.candidateName },
  { header: 'Internal / External', value: (r) => r.candidateType },
  { header: 'Interview score', value: (r) => round1(r.interviewScore) },
  { header: 'Panel recommendation', value: (r) => r.recommendation },
  { header: 'Interview round', value: (r) => r.roundNumber },
  { header: 'Application status', value: (r) => r.status },
  { header: 'Offer status', value: (r) => r.offerStatus }
];

async function meritListReport(vacancyId) {
  const board = await meritList.getBoard(vacancyId);
  return {
    vacancy: board.vacancy,
    count: board.entries.length,
    candidateIds: board.entries.map((e) => e.candidateId),
    filename: `merit-list-${fileSlug(board.vacancy.jobRef)}.csv`,
    csv: toCsv(MERIT_COLUMNS, board.entries)
  };
}

module.exports = { shortlistReport, meritListReport, SHORTLIST_COLUMNS, MERIT_COLUMNS };
