const surveys = require('../services/applicantSurveyService');
const audit = require('../services/auditService');
const { sendError } = require('../utils/errorResponse');
const { toCsv, sendCsv } = require('../utils/csv');

// The applicant survey (services/applicantSurveyService.js).
//   Internal candidates: GET  /api/feedback/application-survey/:applicationId
//                        POST /api/feedback/application-survey
//   HR (any tier) and system administrators:
//                        GET  /api/feedback/application-surveys[?from=&to=]
//                        GET  /api/feedback/application-surveys/export

function internalOnly(req, res) {
  if (req.user.candidateType === 'Internal') return true;
  res.status(403).json({ error: 'This survey is for UCAA employees applying on Internal Careers', code: 'SURVEY_INTERNAL_ONLY' });
  return false;
}

async function status(req, res) {
  if (!internalOnly(req, res)) return;
  try {
    res.json(await surveys.status(req.user.id, req.params.applicationId));
  } catch (err) {
    sendError(res, err);
  }
}

async function submit(req, res) {
  if (!internalOnly(req, res)) return;
  try {
    res.status(201).json(await surveys.submit(req.user.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
}

async function list(req, res) {
  res.json(await surveys.list(req.query));
}

const COLUMNS = [
  { header: 'Submitted', value: (r) => r.submittedAt },
  { header: 'Vacancy', value: (r) => r.vacancyTitle },
  { header: 'Job reference', value: (r) => r.jobRef },
  { header: 'Overall (1-5)', value: (r) => r.overallRating },
  { header: 'Ease of applying (1-5)', value: (r) => r.easeRating },
  { header: 'Clear instructions (1-5)', value: (r) => r.clarityRating },
  { header: 'Time taken', value: (r) => r.timeTakenLabel },
  { header: 'Had problems', value: (r) => (r.hadProblems ? 'Yes' : 'No') },
  { header: 'Problems', value: (r) => r.problems },
  { header: 'Suggestions', value: (r) => r.suggestions }
];

async function exportCsv(req, res) {
  const { responses } = await surveys.list(req.query);
  await audit.record({
    entityType: 'ApplicantSurvey', entityId: 0, action: 'Applicant feedback exported',
    actor: audit.actorFrom(req), details: { rows: responses.length, from: req.query.from || null, to: req.query.to || null }
  });
  sendCsv(res, `applicant-feedback-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(COLUMNS, responses));
}

module.exports = { status, submit, list, exportCsv };
