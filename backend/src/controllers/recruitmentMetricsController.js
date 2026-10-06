const metrics = require('../services/recruitmentMetricsService');
const conflictOfInterest = require('../services/conflictOfInterestService');
const audit = require('../services/auditService');
const { cell, sendCsv } = require('../utils/csv');
const { SOURCES } = require('../utils/applicationSources');

// The recruitment dashboard (recruitmentMetricsService) and its export.
// Vacancies the requester applied for stay out of it, as everywhere else.

// GET /api/analytics/recruitment?from&to&directorateId&departmentId&positionId&grade&location&postingType
async function get(req, res) {
  const excluded = await conflictOfInterest.conflictedVacancyIds(req);
  res.json({ ...(await metrics.compute(req.query, excluded)), sources: SOURCES });
}

// GET /api/analytics/recruitment/export?... - the same, as one CSV: a
// summary of every metric (value, formula, source, refresh), then each
// metric's rows (FR-ATS-073). Names of hired candidates appear in the time
// to hire rows, so the export is recorded.
async function exportCsv(req, res) {
  const excluded = await conflictOfInterest.conflictedVacancyIds(req);
  const report = await metrics.compute(req.query, excluded);
  const line = (cells) => cells.map(cell).join(',');
  const filters = Object.entries(req.query).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ') || 'none';
  const lines = [
    line(['UCAA recruitment dashboard']), line(['Generated', report.generatedAt.toISOString()]), line(['Filters', filters]),
    line(['Vacancies in range', report.vacancies]), '',
    line(['Metric', 'Value', 'Unit', 'In brief', 'Formula', 'Data source', 'Refresh'])
  ];
  for (const m of report.metrics) lines.push(line([m.label, m.value, m.unit, m.summary, m.formula, m.source, m.refresh]));
  for (const m of report.metrics) {
    lines.push('', line([m.label]), line(m.columns.map((c) => c.label)));
    for (const r of m.rows) lines.push(line(m.columns.map((c) => r[c.key])));
  }
  await audit.record({
    entityType: 'Report', entityId: 0, action: 'Recruitment dashboard exported', actor: audit.actorFrom(req), details: { filters: req.query }
  });
  sendCsv(res, `recruitment-dashboard-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${lines.join('\r\n')}\r\n`);
}

module.exports = { get, exportCsv };
