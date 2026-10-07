const directorateModel = require('../models/directorateModel');
const orgApproval = require('../services/orgApprovalService');
const orgAdmin = require('../services/orgAdminService');
const { clean, normalizeCode, codeError, nameError } = require('../utils/orgFields');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Directorates are foundational and rarely change - adding one is Principal
// HR Officer and above. Approved at once unless "Approve now" is unticked,
// when another PHRO+ approves it (services/orgApprovalService.js). Each has
// a short code (DHRA) and its full name.
async function create(req, res) {
  const code = normalizeCode(req.body.code);
  const name = clean(req.body.name);
  const invalid = codeError(code, 'directorate') || nameError(name, 'directorate');
  if (invalid) return res.status(400).json({ error: invalid });

  if (await directorateModel.findByCode(code)) {
    return res.status(409).json({ error: `A directorate with the code ${code} already exists` });
  }
  if (await directorateModel.findByName(name)) {
    return res.status(409).json({ error: 'A directorate with this name already exists' });
  }

  const state = await orgApproval.initialState(req);
  const directorate = await directorateModel.create({
    code, name, directorName: clean(req.body.directorName) || null, directorEmail: clean(req.body.directorEmail) || null,
    createdById: req.user.id, ...state.data
  });
  await orgApproval.recordCreated(req, 'Directorate', directorate, state);
  if (!state.autoApproved) broadcastDashboardEvent('OrgPendingApproval', { directorateId: directorate.id });
  res.status(201).json({ ...directorate, autoApproved: state.autoApproved });
}

// Any HR staff member can list directorates (with their status and how many
// departments and positions each has) - the Directorates page, and the
// dropdown when adding a department.
async function list(req, res) {
  res.json(await orgAdmin.listDirectorates());
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

// PATCH /api/directorates/:id { code, name, directorName, directorEmail }
async function update(req, res) {
  const updated = await orgAdmin.edit(req, 'Directorate', Number(req.params.id));
  broadcastDashboardEvent('OrgChanged', { directorateId: updated.id });
  res.json(updated);
}

// DELETE /api/directorates/:id { reason } - only while it has no departments.
async function remove(req, res) {
  const result = await orgAdmin.remove(req, 'Directorate', Number(req.params.id), req.body?.reason);
  broadcastDashboardEvent('OrgChanged', { directorateId: result.id });
  res.json(result);
}

module.exports = { create, list, listPending, approve, reject, update, remove };
