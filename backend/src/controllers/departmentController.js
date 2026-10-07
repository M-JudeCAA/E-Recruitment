const departmentModel = require('../models/departmentModel');
const directorateModel = require('../models/directorateModel');
const slaModel = require('../models/slaModel');
const orgApproval = require('../services/orgApprovalService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Departments are structural - a new department affects reporting lines and
// vacancy scoping org-wide - so one can be used on a vacancy only once
// approved (services/orgApprovalService.js: a Principal HR Officer or above
// approves their own at once unless they untick "Approve now"; anyone
// else's waits for a PHRO+ who did not propose it).
async function propose(req, res) {
  const { name, directorateId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Department name is required' });
  }
  const directorate = await directorateModel.findById(Number(directorateId));
  if (!directorate || directorate.status === 'Rejected') {
    return res.status(400).json({ error: 'Select a valid directorate' });
  }

  const existing = await departmentModel.findByNameAndDirectorate(name.trim(), directorate.id);
  if (existing) {
    return res.status(409).json({ error: 'A department with this name already exists under this directorate' });
  }

  const state = await orgApproval.initialState(req);
  const department = await departmentModel.create({
    name: name.trim(), directorateId: directorate.id, createdById: req.user.id, ...state.data
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

async function listAllForAdmin(req, res) {
  const departments = await departmentModel.findAllForAdmin();
  res.json(departments);
}

async function approve(req, res) {
  const updated = await orgApproval.decide(req, 'Department', Number(req.params.id), 'approve');
  // See the same note in applicationController.approveOffer: without this,
  // an escalated DepartmentApproval task never clears.
  await slaModel.resolveEscalations('DepartmentApproval', updated.id);
  broadcastDashboardEvent('DepartmentApproved', { departmentId: updated.id });
  res.json(updated);
}

async function reject(req, res) {
  const updated = await orgApproval.decide(req, 'Department', Number(req.params.id), 'reject', req.body?.reason);
  await slaModel.resolveEscalations('DepartmentApproval', updated.id);
  broadcastDashboardEvent('DepartmentRejected', { departmentId: updated.id });
  res.json(updated);
}

module.exports = { propose, listApproved, listPending, listAllForAdmin, approve, reject };
