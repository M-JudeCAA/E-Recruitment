const auditService = require('../services/auditService');

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

module.exports = { history };
