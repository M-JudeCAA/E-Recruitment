const express = require('express');
const controller = require('../controllers/shortlistPanelController');

const router = express.Router();

// Public - a shortlisting committee member's private link (see
// shortlistPanelController.js).
router.get('/:token', controller.view);
router.get('/:token/applicants/:applicationId', controller.applicant);
router.put('/:token/applicants/:applicationId/ratings', controller.saveRatings);
router.post('/:token/applicants/:applicationId/conflict', controller.declareConflict);
router.post('/:token/submit', controller.submit);
router.put('/:token/decisions', controller.decide);
router.get('/:token/files/:filename', controller.file);

module.exports = router;
