const exportService = require('../services/exportService');
const audit = require('../services/auditService');
const { sendCsv } = require('../utils/csv');
const { sendError } = require('../utils/errorResponse');

// CSV downloads for a vacancy (FR-ATS-053). Taking candidate data out of
// the system is itself recorded in the vacancy's history (FR-ATS-081).

function vacancyIdFrom(req, res) {
  const vacancyId = Number(req.params.id ?? req.params.vacancyId);
  if (!Number.isInteger(vacancyId) || vacancyId <= 0) {
    res.status(400).json({ error: 'Invalid vacancy id' });
    return null;
  }
  return vacancyId;
}

function exporter(build, action) {
  return async (req, res) => {
    const vacancyId = vacancyIdFrom(req, res);
    if (!vacancyId) return;
    let report;
    try {
      report = await build(vacancyId);
    } catch (err) {
      return sendError(res, err);
    }
    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action, actor: audit.actorFrom(req), details: { rows: report.count }
    });
    sendCsv(res, report.filename, report.csv);
  };
}

module.exports = {
  shortlistReport: exporter(exportService.shortlistReport, 'Shortlisting report exported'),
  meritList: exporter(exportService.meritListReport, 'Merit list exported')
};
