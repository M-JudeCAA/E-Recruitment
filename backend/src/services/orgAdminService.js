const prisma = require('../config/db');
const audit = require('./auditService');
const slaModel = require('../models/slaModel');
const delegationModel = require('../models/delegationModel');
const { approverRights } = require('./orgApprovalService');
const { levelFromInput, LEVEL_WORDS } = require('../utils/positionLevels');
const { clean, normalizeCode, codeError, nameError } = require('../utils/orgFields');
const { AppError } = require('../utils/errorResponse');

// Managing the organisation structure after something is added - the
// Directorates, Departments and Positions pages: lists with what each one
// holds, editing, and deleting what nothing uses.
//
//   - A Principal HR Officer or above (own role or delegation) edits or
//     deletes any directorate, department or position.
//   - Whoever added an item may edit or withdraw (delete) it while it still
//     waits for approval.
//   - A rejected item can't be edited - delete it and add it again.
//   - Deleting is refused while anything uses the item: a directorate with
//     departments, a department with positions, vacancies or staff, a
//     position with vacancies.
//
// Every edit and deletion is audited (action "Edited" / "Deleted", entity
// types Directorate / Department / Position), so it shows in Recent changes
// and in the item's own history.

const ENTITY = {
  Directorate: { model: 'directorate', word: 'directorate', taskType: 'DirectorateApproval' },
  Department: { model: 'department', word: 'department', taskType: 'DepartmentApproval' },
  Position: { model: 'position', word: 'position', taskType: 'PositionApproval' }
};

const STAFF_NAME = { select: { id: true, name: true } };
const IMPORT = { select: { id: true, fileName: true } };

function fail(message, status, code) {
  const err = new AppError(message, status);
  if (code) err.code = code;
  return err;
}

const capital = (word) => `${word[0].toUpperCase()}${word.slice(1)}`;

// The rights this person has over one item; throws when they have none.
async function rightsOver(req, entityType, row, action) {
  const { word } = ENTITY[entityType];
  const rights = await approverRights(req);
  if (rights.canApprove) {
    if (rights.delegation) {
      await delegationModel.logUsage(rights.delegation.id, `${req.method} ${req.originalUrl} (${action} ${word})`);
      req.actingAsDelegateFor = rights.delegation.delegatorId;
    }
    return rights;
  }
  if (row.status === 'Pending' && row.createdById === req.user.id) return rights;
  throw fail(
    row.status === 'Pending'
      ? `Only whoever added this ${word} or a Principal HR Officer or above can ${action} it`
      : `Only a Principal HR Officer or above can ${action} an approved ${word}`,
    403, 'ORG_EDIT_NOT_ALLOWED'
  );
}

async function load(entityType, id) {
  const { model, word } = ENTITY[entityType];
  if (!Number.isInteger(id)) throw fail(`Invalid ${word}`, 400);
  const row = await prisma[model].findUnique({ where: { id } });
  if (!row) throw fail(`${capital(word)} not found`, 404);
  return row;
}

// Whether another row in the same scope already has this value (the
// database compares without case).
async function taken(model, where, id) {
  return Boolean(await prisma[model].findFirst({ where: { ...where, NOT: { id } }, select: { id: true } }));
}

// --- Lists ------------------------------------------------------------------

async function listDirectorates() {
  const rows = await prisma.directorate.findMany({
    include: {
      createdBy: STAFF_NAME, approvedBy: STAFF_NAME, import: IMPORT,
      departments: { select: { status: true, _count: { select: { positions: true } } } }
    },
    orderBy: { code: 'asc' }
  });
  return rows.map(({ departments, ...d }) => ({
    ...d,
    departmentCount: departments.length,
    positionCount: departments.reduce((n, dep) => n + dep._count.positions, 0)
  }));
}

async function listDepartments() {
  const rows = await prisma.department.findMany({
    include: {
      directorate: true, createdBy: STAFF_NAME, approvedBy: STAFF_NAME, import: IMPORT,
      _count: { select: { positions: true, vacancies: true, staff: true } }
    },
    orderBy: [{ directorate: { code: 'asc' } }, { code: 'asc' }]
  });
  return rows.map(({ _count, ...d }) => ({ ...d, positionCount: _count.positions, vacancyCount: _count.vacancies, staffCount: _count.staff }));
}

async function listPositions() {
  const rows = await prisma.position.findMany({
    include: {
      department: { include: { directorate: true } }, createdBy: STAFF_NAME, approvedBy: STAFF_NAME, import: IMPORT,
      _count: { select: { vacancies: true, vacanciesReportingHere: true } }
    },
    orderBy: [{ department: { directorate: { code: 'asc' } } }, { department: { code: 'asc' } }, { level: 'desc' }, { name: 'asc' }]
  });
  return rows.map(({ _count, ...p }) => ({ ...p, vacancyCount: _count.vacancies, reportingVacancyCount: _count.vacanciesReportingHere }));
}

// --- Editing ----------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The new values from the body, checked; only fields sent are changed.
async function editedFields(entityType, row, body) {
  const { word, model } = ENTITY[entityType];
  const data = {};
  if ('code' in body || (entityType === 'Position' && !row.code)) {
    const code = normalizeCode(body.code);
    const error = codeError(code, word);
    if (error) throw fail(error, 400);
    data.code = code;
  }
  if ('name' in body) {
    const name = clean(body.name);
    const error = nameError(name, word);
    if (error) throw fail(error, 400);
    data.name = name;
  }

  if (entityType === 'Directorate') {
    for (const field of ['directorName', 'directorEmail']) {
      if (field in body) data[field] = clean(body[field]) || null;
    }
    if (data.directorEmail && !EMAIL_RE.test(data.directorEmail)) throw fail("The director's email doesn't look right", 400);
    if (data.code !== undefined && await taken(model, { code: data.code }, row.id)) throw fail(`Another directorate already has the code ${data.code}`, 409, 'ORG_DUPLICATE');
    if (data.name !== undefined && await taken(model, { name: data.name }, row.id)) throw fail(`Another directorate is already called ${data.name}`, 409, 'ORG_DUPLICATE');
  }

  if (entityType === 'Department') {
    let directorateId = row.directorateId;
    if ('directorateId' in body && Number(body.directorateId) !== row.directorateId) {
      const target = await prisma.directorate.findUnique({ where: { id: Number(body.directorateId) } });
      if (!target || target.status === 'Rejected') throw fail('Select a valid directorate', 400);
      directorateId = target.id;
      data.directorateId = directorateId;
    }
    const code = data.code ?? row.code;
    const name = data.name ?? row.name;
    if (await taken(model, { code, directorateId }, row.id)) throw fail(`That directorate already has a department with the code ${code}`, 409, 'ORG_DUPLICATE');
    if (await taken(model, { name, directorateId }, row.id)) throw fail(`That directorate already has a department called ${name}`, 409, 'ORG_DUPLICATE');
  }

  if (entityType === 'Position') {
    if ('level' in body) {
      const level = levelFromInput(body.level);
      if (!level) throw fail(`Level must be one of: ${LEVEL_WORDS.join(', ')}`, 400);
      data.level = level;
    }
    if (data.code !== undefined && await taken(model, { code: data.code, departmentId: row.departmentId }, row.id)) {
      throw fail(`That department already has a position with the code ${data.code}`, 409, 'ORG_DUPLICATE');
    }
    if (data.name !== undefined && await taken(model, { name: data.name, departmentId: row.departmentId }, row.id)) {
      throw fail(`That department already has a position called ${data.name}`, 409, 'ORG_DUPLICATE');
    }
  }
  return data;
}

async function edit(req, entityType, id) {
  const { model, word } = ENTITY[entityType];
  const row = await load(entityType, id);
  if (row.status === 'Rejected') throw fail(`A rejected ${word} can't be edited - delete it and add it again`, 422);
  await rightsOver(req, entityType, row, 'edit');

  const data = await editedFields(entityType, row, req.body || {});
  const fields = Object.keys(data).filter((f) => String(data[f] ?? '') !== String(row[f] ?? ''));
  if (!fields.length) return row;

  let updated;
  try {
    updated = await prisma[model].update({ where: { id }, data });
  } catch (err) {
    if (err.code === 'P2002') throw fail(`Another ${word} already has that code or name`, 409, 'ORG_DUPLICATE');
    throw err;
  }
  await audit.record({
    entityType, entityId: id, action: 'Edited', actor: audit.actorFrom(req),
    before: row, after: updated, fields,
    details: { name: updated.name, code: updated.code }
  });
  return updated;
}

// --- Deleting ---------------------------------------------------------------

const USES = {
  Directorate: { count: { departments: true }, say: (c) => c.departments && `${c.departments} department(s)` },
  Department: {
    count: { positions: true, vacancies: true, staff: true },
    say: (c) => [c.positions && `${c.positions} position(s)`, c.vacancies && `${c.vacancies} vacancy(ies)`, c.staff && `${c.staff} staff account(s)`].filter(Boolean).join(', ')
  },
  Position: {
    count: { vacancies: true, vacanciesReportingHere: true },
    say: (c) => [c.vacancies && `${c.vacancies} vacancy(ies)`, c.vacanciesReportingHere && `${c.vacanciesReportingHere} vacancy(ies) reporting to it`].filter(Boolean).join(', ')
  }
};

async function remove(req, entityType, id, reason) {
  const { model, word, taskType } = ENTITY[entityType];
  const row = await load(entityType, id);
  await rightsOver(req, entityType, row, 'delete');

  const { _count: counts } = await prisma[model].findUnique({ where: { id }, select: { _count: { select: USES[entityType].count } } });
  const inUse = USES[entityType].say(counts);
  if (inUse) throw fail(`This ${word} can't be deleted while it has ${inUse}`, 409, 'ORG_IN_USE');

  try {
    await prisma[model].delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2003') throw fail(`This ${word} is still in use and can't be deleted`, 409, 'ORG_IN_USE');
    throw err;
  }
  if (row.status === 'Pending') await slaModel.resolveEscalations(taskType, id);
  await audit.record({
    entityType, entityId: id, action: row.status === 'Pending' && row.createdById === req.user.id ? 'Withdrawn' : 'Deleted',
    actor: audit.actorFrom(req),
    before: row, after: {}, fields: ['code', 'name', 'status'],
    comment: clean(reason) || null,
    details: { name: row.name, code: row.code }
  });
  return { deleted: true, id };
}

module.exports = { listDirectorates, listDepartments, listPositions, edit, remove, rightsOver };
