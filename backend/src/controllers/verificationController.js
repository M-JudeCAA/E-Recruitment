const internalProfileModel = require('../models/internalProfileModel');
const { fileUrl } = require('../middleware/upload');

// The two decisions this endpoint is actually for - 'Pending' is the
// default/reset state, never something HR explicitly submits here.
const VALID_DECISIONS = ['HR_Verified', 'Discrepancy_Flagged'];

async function verify(req, res) {
  const candidateId = Number(req.params.candidateId);
  if (!Number.isInteger(candidateId)) return res.status(400).json({ error: 'Invalid candidate id' });
  const { decision, comments } = req.body;
  if (!VALID_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` });
  }
  const supportingDocumentUrl = fileUrl(req.file);

  const hasComments = comments && comments.trim().length >= 20;
  const hasDocument = !!supportingDocumentUrl;

  if (!hasComments && !hasDocument) {
    return res.status(422).json({
      error: 'Verification requires comments (min 20 chars) or a manager recommendation letter'
    });
  }

  const existing = await internalProfileModel.findByCandidateId(candidateId);
  if (!existing) return res.status(404).json({ error: 'No internal profile found for this candidate' });

  const evidenceType = hasDocument ? 'ManagerRecommendationLetter' : 'Comments';

  const profile = await internalProfileModel.updateByCandidateId(candidateId, {
    verificationStatus: decision,
    verificationEvidenceType: evidenceType,
    verificationComments: comments || null,
    supportingDocumentUrl: supportingDocumentUrl || null,
    verifiedById: req.user.id,
    verifiedDate: new Date()
  });

  res.json(profile);
}

module.exports = { verify };
