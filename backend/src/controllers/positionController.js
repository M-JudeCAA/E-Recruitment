const positionModel = require('../models/positionModel');
const departmentModel = require('../models/departmentModel');
const { levelFromInput, LEVEL_WORDS } = require('../utils/positionLevels');
const prisma = require('../config/db');
const headcount = require('../services/headcountService');
const audit = require('../services/auditService');
const orgApproval = require('../services/orgApprovalService');
const orgAdmin = require('../services/orgAdminService');
const { clean, normalizeCode, codeError, nameError } = require('../utils/orgFields');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Any HR Officer can add a position to an approved department. It can be
// used on a vacancy once approved: a Principal HR Officer or above approves
// their own at once unless they untick "Approve now"; anyone else's waits
// for a PHRO+ who did not add it (services/orgApprovalService.js). Each has
// a short code (HRO) and its full title, both unique within its department.
async function create(req, res) {
  const { departmentId, level } = req.body;
  const code = normalizeCode(req.body.code);
  const name = clean(req.body.name);
  const invalid = codeError(code, 'position') || nameError(name, 'position');
  if (invalid) return res.status(400).json({ error: invalid });
  const department = await departmentModel.findById(Number(departmentId));
  if (!department || department.status !== 'Approved' || department.directorate?.status !== 'Approved') {
    return res.status(400).json({ error: 'Select a valid, approved department' });
  }
  const levelValue = levelFromInput(level);
  if (!levelValue) {
    return res.status(400).json({ error: `Level must be one of: ${LEVEL_WORDS.join(', ')}` });
  }
  if (await positionModel.findInDepartment(department.id, { code })) {
    return res.status(409).json({ error: `That department already has a position with the code ${code}` });
  }

  const state = await orgApproval.initialState(req);
  let position;
  try {
    position = await positionModel.create({
      code, name, departmentId: department.id, level: levelValue, createdById: req.user.id, ...state.data
    });
  } catch (err) {
    if (err.code !== 'P2002') throw err;
    return res.status(409).json({ error: 'This position already exists in that department' });
  }
  await orgApproval.recordCreated(req, 'Position', position, state);
  if (!state.autoApproved) broadcastDashboardEvent('OrgPendingApproval', { positionId: position.id });
  res.status(201).json({ ...position, autoApproved: state.autoApproved });
}

async function listPending(req, res) {
  res.json(await positionModel.findPending());
}

// Every position in any state, with its department, headcount and how many
// vacancies use it - the Positions page.
async function listAllForAdmin(req, res) {
  res.json(await orgAdmin.listPositions());
}

// PATCH /api/positions/:id { code, name, level }
async function update(req, res) {
  const updated = await orgAdmin.edit(req, 'Position', Number(req.params.id));
  broadcastDashboardEvent('OrgChanged', { positionId: updated.id });
  res.json(updated);
}

// DELETE /api/positions/:id { reason } - only while no vacancy uses it.
async function remove(req, res) {
  const result = await orgAdmin.remove(req, 'Position', Number(req.params.id), req.body?.reason);
  broadcastDashboardEvent('OrgChanged', { positionId: result.id });
  res.json(result);
}

async function approve(req, res) {
  const updated = await orgApproval.decide(req, 'Position', Number(req.params.id), 'approve');
  broadcastDashboardEvent('OrgApproved', { positionId: updated.id });
  res.json(updated);
}

async function reject(req, res) {
  const updated = await orgApproval.decide(req, 'Position', Number(req.params.id), 'reject', req.body?.reason);
  broadcastDashboardEvent('OrgRejected', { positionId: updated.id });
  res.json(updated);
}

async function listForDropdown(req, res) {
  const positions = await positionModel.findAllForDropdown();
  res.json(positions);
}

// Called after a Title/Position is selected on the vacancy form, to
// populate the Reports To dropdown with only genuinely senior positions
// in that exact department record.
async function listSeniorOptions(req, res) {
  const position = await positionModel.findById(Number(req.params.id));
  if (!position) return res.status(404).json({ error: 'Position not found' });

  const seniorPositions = await positionModel.findSeniorInDepartment(position.departmentId, position.level);
  res.json(seniorPositions);
}

// Populates the Position dropdown only after a Department has been
// chosen, scoped to just that department.
async function listByDepartment(req, res) {
  const departmentId = Number(req.params.id);
  const positions = await positionModel.findByDepartment(departmentId);
  res.json(positions);
}

// GET /api/positions/:id/headcount - the approved headcount and what is
// free of it (FR-ATS-006), for the New Listing form.
async function getHeadcount(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid position id' });
  res.json(await headcount.availability(id));
}

// PUT /api/positions/:id/headcount { headcount, occupied } - Principal HR
// Officer+. headcount null clears it (nothing is checked then).
async function setHeadcount(req, res) {
  const id = Number(req.params.id);
  const position = Number.isInteger(id) ? await prisma.position.findUnique({ where: { id } }) : null;
  if (!position) return res.status(404).json({ error: 'Position not found' });
  const parse = (v) => (v === null || v === '' || v === undefined ? null : Number(v));
  const hc = 'headcount' in req.body ? parse(req.body.headcount) : position.headcount;
  const occupied = 'occupied' in req.body ? parse(req.body.occupied) ?? 0 : position.occupied;
  if (hc !== null && (!Number.isInteger(hc) || hc < 0 || hc > 10000)) return res.status(400).json({ error: 'Headcount must be a whole number from 0' });
  if (!Number.isInteger(occupied) || occupied < 0) return res.status(400).json({ error: 'Filled posts must be a whole number from 0' });
  if (hc !== null && occupied > hc) return res.status(400).json({ error: 'More posts filled than the approved headcount' });
  const updated = await prisma.position.update({
    where: { id }, data: { headcount: hc, occupied, headcountUpdatedAt: new Date(), headcountUpdatedById: req.user.id }
  });
  await audit.record({
    entityType: 'Position', entityId: id, action: 'Position headcount set', actor: audit.actorFrom(req),
    before: position, after: updated, fields: ['headcount', 'occupied']
  });
  res.json({ ...updated, ...(await headcount.availability(id)) });
}

module.exports = {
  create, listForDropdown, listSeniorOptions, listByDepartment, getHeadcount, setHeadcount, listPending, approve, reject,
  listAllForAdmin, update, remove
};
