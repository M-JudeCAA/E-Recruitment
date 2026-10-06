const orgImport = require('../services/orgImportService');
const delegationModel = require('../models/delegationModel');
const departmentModel = require('../models/departmentModel');
const { ROLE_RANK } = require('../middleware/auth');
const { sendError } = require('../utils/errorResponse');
const slaModel = require('../models/slaModel');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Batch import of directorates, departments and positions (HR Officer+).
// See services/orgImportService.js for the file layout and the rules.

// Adding a directorate is Principal HR Officer+, as on the single form -
// directly, or while acting for one under a delegation.
async function directorateRights(req) {
  if ((ROLE_RANK[req.user.role] || 0) >= ROLE_RANK.Principal_HR_Officer) return { canAddDirectorates: true };
  const delegation = await delegationModel.findActiveForDelegate(req.user.id, new Date());
  if (delegation && (ROLE_RANK[delegation.delegator.role] || 0) >= ROLE_RANK.Principal_HR_Officer) {
    return { canAddDirectorates: true, delegation };
  }
  return { canAddDirectorates: false };
}

// GET /api/org-import/template - the .xlsx to fill in.
async function template(req, res) {
  const buffer = await orgImport.template();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="org-structure-import-template.xlsx"');
  res.send(Buffer.from(buffer));
}

// POST /api/org-import/preview - every row checked, nothing changed.
async function preview(req, res) {
  try {
    const { canAddDirectorates } = await directorateRights(req);
    res.json(await orgImport.preview(req.file, { canAddDirectorates }));
  } catch (err) {
    sendError(res, err, 422);
  }
}

// POST /api/org-import - imports the same file, all or nothing.
async function run(req, res) {
  try {
    const { canAddDirectorates, delegation } = await directorateRights(req);
    const result = await orgImport.run(req.file, { staffId: req.user.id, canAddDirectorates });
    if (delegation && result.directorates > 0) {
      await delegationModel.logUsage(delegation.id, `${req.method} ${req.originalUrl} (added ${result.directorates} directorate(s))`);
    }
    if (result.departments > 0) broadcastDashboardEvent('DepartmentPendingApproval', { importId: result.importId });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'IMPORT_HAS_ERRORS') {
      return res.status(422).json({ error: err.message, code: err.code, ...err.details });
    }
    sendError(res, err, 422);
  }
}

// PATCH /api/departments/imports/:importId/approve (Principal HR Officer+) -
// approves every department from one import that is still pending, with the
// same follow-through as approving them one by one.
async function approveImported(req, res) {
  const importId = Number(req.params.importId);
  if (!Number.isInteger(importId)) return res.status(400).json({ error: 'Invalid import' });
  const ids = (await departmentModel.findPendingIdsFromImport(importId)).map((d) => d.id);
  if (ids.length === 0) return res.status(422).json({ error: 'No departments from this import are awaiting approval' });
  const { count } = await departmentModel.approveMany(ids, req.user.id);
  for (const id of ids) {
    await slaModel.resolveEscalations('DepartmentApproval', id);
    broadcastDashboardEvent('DepartmentApproved', { departmentId: id });
  }
  res.json({ approved: count });
}

module.exports = { template, preview, run, approveImported };
