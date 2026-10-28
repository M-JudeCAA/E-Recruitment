const express = require('express');
const { authenticate, requireCandidate, requireSystemAdminOrRole } = require('../middleware/auth');
const controller = require('../controllers/feedbackController');

const router = express.Router();

// The applicant survey: internal candidates answer it after submitting an
// application; HR (any tier) and system administrators read the answers.
const staff = [authenticate, requireSystemAdminOrRole('HR_Officer')];

router.get('/application-survey/:applicationId', authenticate, requireCandidate, controller.status);
router.post('/application-survey', authenticate, requireCandidate, controller.submit);
router.get('/application-surveys', ...staff, controller.list);
router.get('/application-surveys/export', ...staff, controller.exportCsv);

module.exports = router;
