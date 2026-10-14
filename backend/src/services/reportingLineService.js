const prisma = require('../config/db');
const positionModel = require('../models/positionModel');
const { normalizeLabel } = require('../utils/requisitionParser');

// Who a position reports to - the "Reports to" choice on a vacancy.
//
// UCAA's reporting lines:
//   - every Director (and the Deputy Director General) reports to the
//     Director General;
//   - every Manager reports to the head of their directorate - its Director,
//     or for Corporate the Deputy Director General (DDG);
//   - everyone in the head's own office (a Director's Office, the DG Office
//     for the DDG) reports to the head directly;
//   - otherwise, to someone more senior in the same department.
// The requisition states who the job reports to, so anyone more senior in
// the same directorate can be chosen too - listed after the reporting line.
//
// The head is Directorate.headPositionId, set by HR on the Directorates
// page. Until it is set, the one approved Director-level position in the
// directorate stands in, when there is exactly one (Corporate has the DG and
// the DDG, so HR must name it there). The Director General is the approved
// Director-level position called "Director General" (or coded DG).

const MANAGER_LEVEL = 4;
const DIRECTOR_LEVEL = 5;

const DEPARTMENT = { select: { id: true, code: true, name: true, directorateId: true } };

// directorate: the Directorate row (with headPositionId).
async function directorateHead(directorate) {
  if (!directorate) return null;
  if (directorate.headPositionId) {
    const head = await prisma.position.findUnique({ where: { id: directorate.headPositionId }, include: { department: DEPARTMENT } });
    return head && head.status === 'Approved' ? head : null;
  }
  const directors = await prisma.position.findMany({
    where: { level: DIRECTOR_LEVEL, status: 'Approved', department: { directorateId: directorate.id, status: 'Approved' } },
    include: { department: DEPARTMENT },
    take: 2
  });
  return directors.length === 1 ? directors[0] : null;
}

const isDirectorGeneral = (p) => (p.code || '').toUpperCase() === 'DG' || normalizeLabel(p.name) === 'director general';

// The Director General's position, when exactly one is on the organogram.
async function directorGeneral() {
  const found = (await prisma.position.findMany({
    where: { status: 'Approved', level: DIRECTOR_LEVEL, OR: [{ code: 'DG' }, { name: { contains: 'Director General' } }] },
    include: { department: DEPARTMENT }
  })).filter(isDirectorGeneral);
  return found.length === 1 ? found[0] : null;
}

// The positions this one may report to and the one the rules above say it
// reports to (suggestedId, or null when they don't say). Each option has
// `group`: 'line' (the reporting line - more senior in its department, the
// directorate head, the DG) or 'directorate' (more senior elsewhere in the
// directorate); `directorateHead`/`directorGeneral`/`outsideDepartment` say
// what it is. position: with department.directorate (positionModel.findById).
async function optionsFor(position) {
  const directorate = position.department?.directorate;
  const directorateId = directorate?.id ?? position.department?.directorateId;
  const [seniors, head] = await Promise.all([
    positionModel.findSeniorInDepartment(position.departmentId, position.level),
    directorateHead(directorate)
  ]);
  const isHead = Boolean(head) && head.id === position.id;
  const headApplies = Boolean(head) && !isHead && head.level > position.level;
  const dg = (isHead || position.level >= DIRECTOR_LEVEL) && !isDirectorGeneral(position) ? await directorGeneral() : null;

  const options = seniors.map((p) => ({ ...p, group: 'line', outsideDepartment: false, directorateHead: headApplies && p.id === head.id, directorGeneral: Boolean(dg) && p.id === dg.id }));
  const add = (p, extra) => { if (!options.some((o) => o.id === p.id)) options.push({ ...p, group: 'line', outsideDepartment: p.departmentId !== position.departmentId, ...extra }); };
  if (headApplies) add(head, { directorateHead: true });
  if (dg && dg.id !== position.id) add(dg, { directorGeneral: true });

  if (directorateId) {
    const elsewhere = await prisma.position.findMany({
      where: { status: 'Approved', level: { gt: position.level }, departmentId: { not: position.departmentId }, department: { directorateId, status: 'Approved' } },
      include: { department: DEPARTMENT },
      orderBy: [{ level: 'desc' }, { name: 'asc' }]
    });
    for (const p of elsewhere) {
      if (!options.some((o) => o.id === p.id)) options.push({ ...p, group: 'directorate', outsideDepartment: true });
    }
  }

  let suggestedId = null;
  if (dg && (isHead || position.level >= DIRECTOR_LEVEL)) suggestedId = dg.id;
  else if (headApplies && (position.level === MANAGER_LEVEL || position.departmentId === head.departmentId)) suggestedId = head.id;
  return { options, suggestedId };
}

module.exports = { optionsFor, directorateHead, directorGeneral, MANAGER_LEVEL, DIRECTOR_LEVEL };
