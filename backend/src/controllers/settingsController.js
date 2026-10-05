const settings = require('../services/settingsService');
const audit = require('../services/auditService');
const { sendError } = require('../utils/errorResponse');

// GET /api/settings, PUT /api/settings/:key { value } - a system
// administrator or HR Manager+ (the Settings page). Changes are audited.
async function list(req, res) {
  res.json(await settings.list());
}

async function update(req, res) {
  try {
    const { before, after } = await settings.set(req.params.key, req.body?.value, req.user.id);
    await audit.record({
      entityType: 'Setting', entityId: 0, action: `Setting changed: ${settings.DEFINITIONS[req.params.key].label}`,
      actor: audit.actorFrom(req), before: { value: before }, after: { value: after }, fields: ['value'], details: { key: req.params.key }
    });
    res.json(await settings.list());
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { list, update };
