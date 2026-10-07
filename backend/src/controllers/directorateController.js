const directorateModel = require('../models/directorateModel');
const orgApproval = require('../services/orgApprovalService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Directorates are foundational and rarely change - adding one is Principal
// HR Officer and above. Approved at once unless "Approve now" is unticked,
// when another PHRO+ approves it (services/orgApprovalService.js).
async function create(req, res) {
  const { name, directorName, directorEmail } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Directorate name is required' });
  }

  const existing = await directorateModel.findByName(name.trim());
  if (existing) {
    return res.status(409).json({ error: 'A directorate with this name already exists' });
  }

  const state = await orgApproval.initialState(req);
  const directorate = await directorateModel.create({
    name: name.trim(), directorName, directorEmail, createdById: req.user.id, ...state.data
  });
  await orgApproval.recordCreated(req, 'Directorate', directorate, state);
  if (!state.autoApproved) broadcastDashboardEvent('OrgPendingApproval', { directorateId: directorate.id });
  res.status(201).json({ ...directorate, autoApproved: state.autoApproved });
}

// Any HR staff member can list directorates (with their status) - needed to
// populate the dropdown when proposing a new department.
async function list(req, res) {
  const directorates = await directorateModel.findAll();
  res.json(directorates);
}

async function listPending(req, res) {
  res.json(await directorateModel.findPending());
}

async function approve(req, res) {
  const updated = await orgApproval.decide(req, 'Directorate', Number(req.params.id), 'approve');
  broadcastDashboardEvent('OrgApproved', { directorateId: updated.id });
  res.json(updated);
}

async function reject(req, res) {
  const updated = await orgApproval.decide(req, 'Directorate', Number(req.params.id), 'reject', req.body?.reason);
  broadcastDashboardEvent('OrgRejected', { directorateId: updated.id });
  res.json(updated);
}

module.exports = { create, list, listPending, approve, reject };
