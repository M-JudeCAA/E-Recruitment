const express = require('express');
const controller = require('../controllers/candidateController');
const { authenticate, requireCandidate } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authenticate, requireCandidate, controller.me);
router.post('/me/work-experience', authenticate, requireCandidate, controller.addWorkExperience);
router.post('/me/education', authenticate, requireCandidate, controller.addEducation);
router.put('/me/internal-profile', authenticate, requireCandidate, controller.updateInternalProfile);
router.get('/me/applications', authenticate, requireCandidate, controller.myApplications);

module.exports = router;
