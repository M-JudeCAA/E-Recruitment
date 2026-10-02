const prisma = require('../config/db');
const { isConflicted, ApplicantConflictError } = require('../services/conflictOfInterestService');

// Route guard for the conflict-of-interest rule (conflictOfInterestService):
// a staff member who applied for a vacancy is refused (409 APPLICANT_CONFLICT)
// on every staff route that works on that vacancy or its applicants. Goes
// after requireStaffRole, so a delegation in use is already known. `resolve`
// works out which vacancy (or vacancies) the request is about; when it finds
// none (unknown id) the request passes and the controller answers 404 as usual.
function guardVacancy(resolve) {
  return async (req, res, next) => {
    const found = await resolve(req);
    const vacancyIds = (Array.isArray(found) ? found : [found]).filter(Boolean);
    for (const vacancyId of vacancyIds) {
      if (await isConflicted(req, vacancyId)) {
        const err = new ApplicantConflictError();
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
    }
    next();
  };
}

const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Resolvers: from a route/query parameter naming the vacancy itself, or one
// of the things that belong to a vacancy.
const vacancyFrom = {
  param: (name) => (req) => toId(req.params[name]),
  query: (name) => (req) => toId(req.query[name]),
  application: (name) => async (req) => {
    const id = toId(req.params[name]);
    if (!id) return null;
    const row = await prisma.application.findUnique({ where: { id }, select: { vacancyId: true } });
    return row?.vacancyId;
  },
  offer: (name) => async (req) => {
    const id = toId(req.params[name]);
    if (!id) return null;
    const row = await prisma.offer.findUnique({ where: { id }, select: { application: { select: { vacancyId: true } } } });
    return row?.application?.vacancyId;
  },
  interview: (name) => async (req) => {
    const id = toId(req.params[name]);
    if (!id) return null;
    const row = await prisma.interviewRound.findUnique({ where: { id }, select: { application: { select: { vacancyId: true } } } });
    return row?.application?.vacancyId;
  },
  panelMember: (name) => async (req) => {
    const id = toId(req.params[name]);
    if (!id) return null;
    const row = await prisma.panelMember.findUnique({
      where: { id }, select: { interviewRound: { select: { application: { select: { vacancyId: true } } } } }
    });
    return row?.interviewRound?.application?.vacancyId;
  },
  // Every vacancy the candidate has applied for - verifying a rival
  // applicant's internal profile is as much a part of running the vacancy
  // as screening them.
  candidate: (name) => async (req) => {
    const id = toId(req.params[name]);
    if (!id) return null;
    const rows = await prisma.application.findMany({
      where: { candidateId: id, status: { not: 'Draft' } }, select: { vacancyId: true }
    });
    return rows.map((r) => r.vacancyId);
  },
  // GET /api/audit/:entityType/:entityId
  auditEntity: () => async (req) => {
    const id = toId(req.params.entityId);
    switch (req.params.entityType) {
      case 'Vacancy': return id;
      case 'Application': return vacancyFrom.application('entityId')(req);
      case 'Offer': return vacancyFrom.offer('entityId')(req);
      case 'InterviewRound': return vacancyFrom.interview('entityId')(req);
      default: return null;
    }
  }
};

module.exports = { guardVacancy, vacancyFrom };
