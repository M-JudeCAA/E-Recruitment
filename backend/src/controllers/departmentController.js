const departmentModel = require('../models/departmentModel');
const directorateModel = require('../models/directorateModel');
const orgApproval = require('../services/orgApprovalService');
const orgAdmin = require('../services/orgAdminService');
const { clean, normalizeCode, codeError, nameError } = require('../utils/orgFields');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Departments are structural - a new department affects reporting lines and
// vacancy scoping org-wide - so one can be used on a vacancy only once
// approved (services/orgApprovalService.js: a Principal HR Officer or above
// approves their own at once unless they untick "Approve now"; anyone
// else's waits for a PHRO+ who did not propose it). Each has a short code
// (ARFFS) and its full name, both unique within its directorate.
async function propose(req, res) {
  const code = normalizeCode(req.body.code);
  const name = clean(req.body.name);
  const invalid = codeError(code, 'department') || nameError(name, 'department');
  if (invalid) return res.status(400).json({ error: invalid });

  const directorate = await directorateModel.findById(Number(req.body.directorateId));
  if (!directorate || directorate.status === 'Rejected') {
    return res.status(400).json({ error: 'Select a valid directorate' });
  }

  if (await departmentModel.findByCodeAndDirectorate(code, directorate.id)) {
    return res.status(409).json({ error: `A department with the code ${code} already exists under this directorate` });
  }
  if (await departmentModel.findByNameAndDirectorate(name, directorate.id)) {
    return res.status(409).json({ error: 'A department with this name already exists under this directorate' });
  }

  const state = await orgApproval.initialState(req);
  const department = await departmentModel.create({
    code, name, directorateId: directorate.id, createdById: req.user.id, ...state.data
  });
  await orgApproval.recordCreated(req, 'Department', department, state);
  broadcastDashboardEvent(state.autoApproved ? 'DepartmentApproved' : 'DepartmentPendingApproval', { departmentId: department.id });
  res.status(201).json({ ...department, autoApproved: state.autoApproved });
}

async function listApproved(req, res) {
  const departments = await departmentModel.findApproved();
  res.json(departments);
}

async function listPending(req, res) {
  const departments = await departmentModel.findPending();
  res.json(departments);
}

// Every department in any state, with how many positions, vacancies and
// staff each has - the Departments page.
async function listAllForAdmin(req, res) {
  res.json(await orgAdmin.listDepartments());
}

async function approve(req, res) {
  // decide() also closes any escalation of the approval deadline.
  const updated = await orgApproval.decide(req, 'Department', Number(req.params.id), 'approve');
  broadcastDashboardEvent('DepartmentApproved', { departmentId: updated.id });
  res.json(updated);
}

async function reject(req, res) {
  const updated = await orgApproval.decide(req, 'Department', Number(req.params.id), 'reject', req.body?.reason);
  broadcastDashboardEvent('DepartmentRejected', { departmentId: updated.id });
  res.json(updated);
}

// PATCH /api/departments/:id { code, name, directorateId }
async function update(req, res) {
  const updated = await orgAdmin.edit(req, 'Department', Number(req.params.id));
  broadcastDashboardEvent('OrgChanged', { departmentId: updated.id });
  res.json(updated);
}

// DELETE /api/departments/:id { reason } - only while nothing uses it.
async function remove(req, res) {
  const result = await orgAdmin.remove(req, 'Department', Number(req.params.id), req.body?.reason);
  broadcastDashboardEvent('OrgChanged', { departmentId: result.id });
  res.json(result);
}

module.exports = { propose, listApproved, listPending, listAllForAdmin, approve, reject, update, remove };
