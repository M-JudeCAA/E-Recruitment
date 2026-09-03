const express = require('express');
const controller = require('../controllers/applicationController');
const { authenticate, requireStaffRole, requireCandidate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.post('/', authenticate, requireCandidate,
  upload.fields([{ name: 'cv', maxCount: 1 }, { name: 'coverLetter', maxCount: 1 }]),
  controller.submit
);
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
