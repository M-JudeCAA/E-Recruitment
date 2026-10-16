const prisma = require('../config/db');
const { AppError } = require('../utils/errorResponse');
const { usablePosition } = require('./orgApprovalService');

// A UCAA employee's department and position on their internal profile are
// picked from the organisation structure (Internal Careers), never typed in:
// the approved departments and the approved positions in each.

// Departments that are approved and in an approved directorate (or in none),
// each with its approved positions - what the employment form suggests from.
async function choices() {
  const departments = await prisma.department.findMany({
    where: { status: 'Approved', OR: [{ directorateId: null }, { directorate: { status: 'Approved' } }] },
    select: { id: true, code: true, name: true, directorate: { select: { code: true, name: true } } },
    orderBy: { name: 'asc' }
  });
  const positions = await prisma.position.findMany({
    where: { status: 'Approved', departmentId: { in: departments.map((d) => d.id) } },
    select: { id: true, code: true, name: true, departmentId: true },
    orderBy: { name: 'asc' }
  });
  return { departments, positions };
}

const refuse = (message, code) => Object.assign(new AppError(message, 400), { code });

const idOf = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// The profile fields for a picked department and position: the ids and the
// names as they stand. Throws when either wasn't picked from the list, or the
// position isn't one of that department's approved positions.
async function pickedEmployment(body) {
  const departmentId = idOf(body?.departmentId);
  const positionId = idOf(body?.positionId);
  if (!departmentId) throw refuse('Pick your department from the list.', 'DEPARTMENT_NOT_PICKED');
  if (!positionId) throw refuse('Pick your position from the list.', 'POSITION_NOT_PICKED');
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { department: { include: { directorate: true } } }
  });
  if (!usablePosition(position) || position.departmentId !== departmentId) {
    throw refuse('That position isn\'t one of the department\'s - pick your department, then your position, from the lists.', 'POSITION_NOT_IN_DEPARTMENT');
  }
  return { departmentId, positionId, department: position.department.name, position: position.name };
}

module.exports = { choices, pickedEmployment };
