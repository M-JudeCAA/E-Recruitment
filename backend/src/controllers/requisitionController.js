const requisitionService = require('../services/requisitionService');
const { sendError } = require('../utils/errorResponse');

// The answer for a requisition that can't be used, with the machine-readable
// code the frontend acts on (SCANNED_DOCUMENT, DUPLICATE_REQUISITION, ...).
function sendRequisitionError(res, err) {
  if (err?.isAppError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.existing ? { existingVacancy: err.existing } : {})
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

module.exports = { read, uploadSignedCopy, sendRequisitionError };
