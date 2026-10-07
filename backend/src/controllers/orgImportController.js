const orgImport = require('../services/orgImportService');
const orgApproval = require('../services/orgApprovalService');
const delegationModel = require('../models/delegationModel');
const audit = require('../services/auditService');
const { sendError } = require('../utils/errorResponse');
const slaModel = require('../models/slaModel');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Batch import of directorates, departments and positions (HR Officer+).
// See services/orgImportService.js for the file layout and the rules.
// Adding a directorate, and approving what the import adds at once ("Approve
// now", multipart field autoApprove), are Principal HR Officer+ - directly,
// or while acting for one under a delegation.

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
    const { canApprove } = await orgApproval.approverRights(req);
    res.json(await orgImport.preview(req.file, { canAddDirectorates: canApprove }));
  } catch (err) {
    sendError(res, err, 422);
  }
}

// POST /api/org-import - imports the same file, all or nothing.
async function run(req, res) {
  try {
    const { canApprove, delegation } = await orgApproval.approverRights(req);
    const autoApproved = canApprove && orgApproval.wantsAutoApprove(req.body);
    const result = await orgImport.run(req.file, { staffId: req.user.id, canAddDirectorates: canApprove, autoApproved });
    if (delegation && (result.directorates > 0 || autoApproved)) {
      await delegationModel.logUsage(delegation.id, `${req.method} ${req.originalUrl} (${[
        result.directorates > 0 && `added ${result.directorates} directorate(s)`, autoApproved && 'approved on import'
      ].filter(Boolean).join(', ')})`);
      req.actingAsDelegateFor = delegation.delegatorId;
    }
    const state = { autoApproved, canApprove };
    await audit.record({
      entityType: 'OrgImport', entityId: result.importId,
      action: autoApproved ? 'Imported and approved (Approve now)' : 'Imported, sent for approval',
      actor: audit.actorFrom(req),
      comment: `${result.directorates} directorate(s), ${result.departments} department(s) and ${result.positions} position(s) from ${result.fileName}. ${orgApproval.creationNote(state)}`,
      details: {
        name: result.fileName, autoApproved, autoApproveAvailable: canApprove,
        directorates: result.directorates, departments: result.departments, positions: result.positions, skipped: result.skipped
      }
    });
    broadcastDashboardEvent(autoApproved ? 'DepartmentApproved' : 'DepartmentPendingApproval', { importId: result.importId });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'IMPORT_HAS_ERRORS') {
      return res.status(422).json({ error: err.message, code: err.code, ...err.details });
    }
    sendError(res, err, 422);
  }
}

// PATCH /api/departments/imports/:importId/approve (Principal HR Officer+,
// not the importer) - approves every directorate, department and position
// from one import that is still pending, with the same follow-through as
// approving them one by one.
async function approveImported(req, res) {
  const result = await orgApproval.approveImport(req, Number(req.params.importId));
  for (const id of result.departmentIds) {
    await slaModel.resolveEscalations('DepartmentApproval', id);
    broadcastDashboardEvent('DepartmentApproved', { departmentId: id });
  }
  res.json({
    approved: result.directorates + result.departments + result.positions,
    directorates: result.directorates, departments: result.departments, positions: result.positions
  });
}

module.exports = { template, preview, run, approveImported };
