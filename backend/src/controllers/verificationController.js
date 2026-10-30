const { fileUrl } = require('../middleware/upload');
const { removeUploads } = require('../utils/uploadFiles');
const { sendError } = require('../utils/errorResponse');
const verification = require('../services/internalVerificationService');

// HR's check of internal candidates' UCAA employment details
// (services/internalVerificationService.js). Internal candidates submit
// applications only once verified, so HR works from the Employment checks
// queue rather than from an application.

// PATCH /api/verification/candidates/:candidateId/verify
// { decision: HR_Verified | Discrepancy_Flagged, comments } + optional
// recommendationLetter file (the candidate's appointment letter; the field
// and the evidence type ManagerRecommendationLetter keep their old names). 'Pending' is the starting state, never a decision.
async function verify(req, res) {
  const candidateId = Number(req.params.candidateId);
  const documentUrl = fileUrl(req.file);
  if (!Number.isInteger(candidateId)) {
    await removeUploads(documentUrl);
    return res.status(400).json({ error: 'Invalid candidate id' });
  }
  try {
    const profile = await verification.decide(req, candidateId, {
      decision: req.body.decision, comments: req.body.comments, documentUrl
    });
    res.json(profile);
  } catch (err) {
    // A refused decision keeps no upload.
    await removeUploads(documentUrl);
    sendError(res, err, 400);
  }
}

// GET /api/verification/pending[?include=all] - internal candidates waiting
// for HR's check (or every internal profile with include=all).
async function pending(req, res) {
  res.json(await verification.queue(req, { include: req.query.include === 'all' ? 'all' : 'waiting' }));
}

module.exports = { verify, pending };
