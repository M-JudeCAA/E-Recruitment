const express = require('express');
const controller = require('../controllers/applicationController');
const { authenticate, requireStaffRole, requireCandidate } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.post('/', authenticate, requireCandidate,
  upload.fields([{ name: 'cv', maxCount: 1 }, { name: 'coverLetter', maxCount: 1 }]),
  controller.submit
);
router.patch('/:id/shortlist', authenticate, requireStaffRole('HR_Officer'), controller.shortlist);
router.post('/vacancies/:vacancyId/approve-shortlist', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approveShortlist);
router.post('/:id/recommend-offer', authenticate, requireStaffRole('Principal_HR_Officer'), controller.recommendOffer);
router.patch('/offers/:offerId/approve', authenticate, requireStaffRole('DHRA_Manager_HR'), controller.approveOffer);
router.patch('/offers/:offerId/accept', authenticate, requireCandidate, controller.acceptOffer);
router.patch('/offers/:offerId/decline', authenticate, requireCandidate, controller.declineOffer);

module.exports = router;
