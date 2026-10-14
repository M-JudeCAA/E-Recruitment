const adminAudit = require('../services/adminAuditService');
const audit = require('../services/auditService');
const { toCsv, sendCsv } = require('../utils/csv');

// System administrators' audit log (/api/admin/audit) - see
// services/adminAuditService.js. Exports are themselves audited.

const KINDS = ['activity', 'changes', 'access'];

async function list(req, res) {
  const { kind } = req.params;
  if (!KINDS.includes(kind)) return res.status(404).json({ error: 'No such log' });
  res.json(await adminAudit[kind](req.query));
}

async function meta(req, res) {
  res.json(await adminAudit.meta());
}

async function exportCsv(req, res) {
  const { kind } = req.params;
  const definition = adminAudit.EXPORTS[kind];
  if (!definition) return res.status(404).json({ error: 'No such log' });
  const { rows, total } = await definition.load(req.query, { all: true });
  const filters = Object.fromEntries(Object.entries(req.query).filter(([k, v]) => v && !['page', 'pageSize'].includes(k)));
  await audit.record({
    entityType: 'AuditLog', entityId: 0, action: `Exported the ${kind} log`, actor: audit.actorFrom(req),
    details: { rows: rows.length, total, filters }
  });
  sendCsv(res, `audit-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(definition.columns, rows));
}

module.exports = { list, meta, exportCsv };
