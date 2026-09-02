const internalProfileModel = require('../models/internalProfileModel');
const { fileUrl } = require('../middleware/upload');

async function verify(req, res) {
  const candidateId = Number(req.params.candidateId);
  const { decision, comments } = req.body;
  const supportingDocumentUrl = fileUrl(req.file);

  const hasComments = comments && comments.trim().length >= 20;
  const hasDocument = !!supportingDocumentUrl;

  if (!hasComments && !hasDocument) {
    return res.status(422).json({
      error: 'Verification requires comments (min 20 chars) or a manager recommendation letter'
    });
  }

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
