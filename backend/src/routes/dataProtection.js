const express = require('express');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const controller = require('../controllers/dataProtectionController');

const router = express.Router();
const gate = [authenticate, requireStaffRole('Manager')];

// Candidates' erasure requests and the purge log - HR Manager+.
router.get('/requests', ...gate, controller.listRequests);
router.patch('/requests/:id/complete', ...gate, controller.complete);
router.patch('/requests/:id/refuse', ...gate, controller.refuse);
router.get('/purges', ...gate, controller.listPurges);

module.exports = router;
