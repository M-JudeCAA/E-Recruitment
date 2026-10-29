const requisitionService = require('../services/requisitionService');
const signedCopies = require('../services/requisitionSignedCopyService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { sendError } = require('../utils/errorResponse');

// The answer for a requisition that can't be used, with the machine-readable
// code the frontend acts on (SCANNED_DOCUMENT, DUPLICATE_REQUISITION, ...).
function sendRequisitionError(res, err) {
  if (err?.isAppError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.existing ? { existingVacancy: err.existing } : {}),
      ...(err.details ? { headcount: err.details } : {})
    });
  }
  return sendError(res, err);
}

// POST /api/vacancies/requisition - step 1 of creating a vacancy: read the
// uploaded, EXCO-approved requisition and return the pre-filled form for HR
// to review. Nothing is created until HR submits the form.
async function read(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose the requisition document to upload', code: 'REQUISITION_REQUIRED' });
  try {
    res.json(await requisitionService.read(req.file));
  } catch (err) {
    sendRequisitionError(res, err);
  }
}

// POST /api/vacancies/requisition/signed-copy - the scan of the requisition
// as EXCO signed it, kept with the vacancy next to the readable document.
async function uploadSignedCopy(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Choose the scan of the signed requisition to upload', code: 'SIGNED_COPY_REQUIRED' });
  try {
    res.json(await requisitionService.storeSignedCopy(req.file));
  } catch (err) {
    sendRequisitionError(res, err);
  }
}

// PUT /api/vacancies/:id/requisition/signed-copy - replace an existing
// vacancy's signed copy (multipart `document`, `reason`); the rules are in
// requisitionSignedCopyService.
async function replaceSignedCopy(req, res) {
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(400).json({ error: 'Invalid vacancy id' });
  try {
    const change = await signedCopies.replace(req, vacancyId, req.file, req.body?.reason);
    broadcastDashboardEvent('VacancyUpdated', { vacancyId });
    res.json(change);
  } catch (err) {
    sendRequisitionError(res, err);
  }
}

// GET /api/vacancies/:id/requisition/signed-copy/history
async function signedCopyHistory(req, res) {
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(400).json({ error: 'Invalid vacancy id' });
  res.json(await signedCopies.history(vacancyId));
}

module.exports = { read, uploadSignedCopy, replaceSignedCopy, signedCopyHistory, sendRequisitionError };
