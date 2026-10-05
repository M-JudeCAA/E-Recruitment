const auditService = require('../services/auditService');
const accessLog = require('../services/accessLogService');
const applicationModel = require('../models/applicationModel');

// GET /api/audit/:entityType/:entityId - the history of one vacancy,
// application, offer or interview round, newest first. Only the changed
// values and comments are returned, never the rest of the stored payload
// (qualification snapshots and the like stay server-side).
async function history(req, res) {
  const { entityType } = req.params;
  const entityId = Number(req.params.entityId);
  if (!auditService.HISTORY_ENTITY_TYPES.includes(entityType)) {
    return res.status(400).json({ error: `History is available for: ${auditService.HISTORY_ENTITY_TYPES.join(', ')}` });
  }
  if (!Number.isInteger(entityId) || entityId <= 0) return res.status(400).json({ error: 'Invalid id' });
  res.json(await auditService.history(entityType, entityId));
}

// GET /api/audit/access/applications/:applicationId - who has viewed this
// applicant's data (FR-ATS-081), newest first: the application itself, and
// the lists, documents and exports it appeared in. Manager+.
async function access(req, res) {
  const applicationId = Number(req.params.applicationId);
  if (!Number.isInteger(applicationId) || applicationId <= 0) return res.status(400).json({ error: 'Invalid id' });
  const application = await applicationModel.findById(applicationId);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  res.json(await accessLog.forApplication(applicationId, application.candidateId));
}

module.exports = { history, access };
