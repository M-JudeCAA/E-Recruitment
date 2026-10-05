const express = require('express');
const controller = require('../controllers/bulkEmailController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Bulk email to candidates (FR-ATS-050) - Senior HR Officer+. The conflict
// of interest check is in the controller: one send can span vacancies.
const write = [authenticate, requireStaffRole('Senior_HR_Officer')];

router.get('/templates', ...write, controller.listTemplates);
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.list);
router.post('/preview', ...write, controller.preview);
router.post('/send', ...write, controller.send);

module.exports = router;
