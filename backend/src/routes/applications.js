const express = require('express');
const controller = require('../controllers/applicationController');
const draftController = require('../controllers/applicationDraftController');
const { authenticate, requireStaffRole, requireCandidate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// REPLACES the old single-step submit() entirely (was the old one-step
// controller.submit). saveDraft() handles both first-save and every
// subsequent edit to that same draft.
router.post('/', authenticate, requireCandidate,
  upload.fields([{ name: 'cv', maxCount: 1 }, { name: 'coverLetter', maxCount: 1 }]),
  draftController.saveDraft
);
// The explicit "I'm done, submit this" action.
router.patch('/:id/submit', authenticate, requireCandidate, draftController.submit);
// Candidate withdraws their own Draft or Submitted application.
router.patch('/:id/withdraw', authenticate, requireCandidate, draftController.withdraw);

// "Review & shortlist candidates" is a Senior HR Officer+ capability per
// the 5-tier permission table - an HR Officer can create/propose but not
// review/shortlist.
router.patch('/:id/shortlist', authenticate, requireStaffRole('Senior_HR_Officer'), controller.shortlist);
router.post('/vacancies/:vacancyId/approve-shortlist', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approveShortlist);
router.post('/:id/recommend-offer', authenticate, requireStaffRole('Principal_HR_Officer'), controller.recommendOffer);
// "Approve a final offer" explicitly excludes Principal HR Officer - only
// Manager and Director can, per the 5-tier permission table (Decision #10:
// PHRO can recommend but never approve).
router.patch('/offers/:offerId/approve', authenticate, requireStaffRole('Manager'), controller.approveOffer);
router.patch('/offers/:offerId/accept', authenticate, requireCandidate, controller.acceptOffer);
router.patch('/offers/:offerId/decline', authenticate, requireCandidate, controller.declineOffer);

module.exports = router;
