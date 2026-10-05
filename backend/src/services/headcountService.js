const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');

// Approved headcount (FR-ATS-006). A position may carry its approved
// establishment (`headcount`) and how many of those posts are filled now
// (`occupied`, kept by HR; Mark as Hired adds one). A vacancy asks for
// `positionsRequired` of them; what other vacancies for the same position
// are still recruiting for counts against the same posts. Asking for more
// than are free is an exception: it needs a reason, and a Director must
// authorise it when the vacancy is approved (vacancyController.approve).
// No headcount recorded means nothing to check against.

// Vacancies still recruiting - their unfilled positions are spoken for.
const RECRUITING = ['PendingApproval', 'Returned', 'Open', 'PartiallyFilled'];
const MIN_REASON = 10;

/**
 * { headcount, occupied, inRecruitment, available } for a position, leaving
 * out one vacancy (the one being edited). headcount null: not recorded.
 */
async function availability(positionId, excludeVacancyId = null) {
  const position = await prisma.position.findUnique({ where: { id: positionId }, select: { headcount: true, occupied: true } });
  if (!position || position.headcount == null) return { headcount: null, occupied: position?.occupied ?? 0, inRecruitment: 0, available: null };
  const vacancies = await prisma.vacancy.findMany({
    where: { positionId, status: { in: RECRUITING }, ...(excludeVacancyId ? { id: { not: excludeVacancyId } } : {}) },
    select: { id: true, positionsRequired: true, _count: { select: { hires: true } } }
  });
  const inRecruitment = vacancies.reduce((n, v) => n + Math.max(0, v.positionsRequired - v._count.hires), 0);
  return {
    headcount: position.headcount, occupied: position.occupied, inRecruitment,
    available: Math.max(0, position.headcount - position.occupied - inRecruitment)
  };
}

function describe(a) {
  return `${a.headcount} approved, ${a.occupied} filled, ${a.inRecruitment} already being recruited for - ${a.available} free`;
}

/**
 * Checks a vacancy asking for `positionsRequired` posts. Returns null when
 * within headcount (or none recorded), else the exception to store in
 * requisitionDetails.headcountException - throws 422 HEADCOUNT_EXCEEDED when
 * no reason was given.
 */
async function exceptionFor(positionId, positionsRequired, reasonInput, staffId, excludeVacancyId = null) {
  const a = await availability(positionId, excludeVacancyId);
  if (a.headcount == null || positionsRequired <= a.available) return null;
  const reason = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, 2000) : '';
  if (reason.length < MIN_REASON) {
    const err = new AppError(`This vacancy asks for ${positionsRequired} post(s) but the approved headcount leaves ${a.available} (${describe(a)}). `
      + 'Give the reason for the exception - a Director must then authorise it.', 422);
    err.code = 'HEADCOUNT_EXCEEDED';
    err.details = a;
    throw err;
  }
  return { reason, requested: positionsRequired, ...a, requestedById: staffId, requestedAt: new Date().toISOString() };
}

module.exports = { availability, exceptionFor, describe, RECRUITING, MIN_REASON };
