const departmentModel = require('../models/departmentModel');
const directorateModel = require('../models/directorateModel');
const slaModel = require('../models/slaModel');

// Departments are structural (unlike Positions, which any HR Officer can
// add freely) - a new department affects reporting lines and vacancy
// scoping org-wide, so it goes through Principal HR Officer approval
// before it can be selected on the vacancy form.
async function propose(req, res) {
  const { name, directorateId } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Department name is required' });
  }
  const directorate = await directorateModel.findById(Number(directorateId));
  if (!directorate) {
    return res.status(400).json({ error: 'Select a valid directorate' });
  }

  const existing = await departmentModel.findByNameAndDirectorate(name.trim(), directorate.id);
  if (existing) {
    return res.status(409).json({ error: 'A department with this name already exists under this directorate' });
  }

  const department = await departmentModel.create({
    name: name.trim(), directorateId: directorate.id, status: 'Pending', createdById: req.user.id
  });
  res.status(201).json(department);
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
  const department = await departmentModel.findById(Number(req.params.id));
  if (!department) return res.status(404).json({ error: 'Department not found' });
  if (department.status !== 'Pending') {
    return res.status(422).json({ error: 'This department is not awaiting approval' });
  }
  const updated = await departmentModel.update(department.id, {
    status: 'Approved', approvedById: req.user.id, approvedAt: new Date(), rejectionReason: null
  });
  // See the same note in applicationController.approveOffer: the spec
  // defines slaModel.resolveEscalations but never invokes it anywhere -
  // without this, an escalated DepartmentApproval task never clears.
  await slaModel.resolveEscalations('DepartmentApproval', department.id);
  res.json(updated);
}

async function reject(req, res) {
  const department = await departmentModel.findById(Number(req.params.id));
  if (!department) return res.status(404).json({ error: 'Department not found' });
  if (department.status !== 'Pending') {
    return res.status(422).json({ error: 'This department is not awaiting approval' });
  }

  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A rejection reason is required' });
  }

  const updated = await departmentModel.update(department.id, {
    status: 'Rejected', approvedById: req.user.id, approvedAt: new Date(), rejectionReason: reason
  });
  await slaModel.resolveEscalations('DepartmentApproval', department.id);
  res.json(updated);
}

module.exports = { propose, listApproved, listPending, listAllForAdmin, approve, reject };
