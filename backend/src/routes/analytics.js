const express = require('express');
const controller = require('../controllers/analyticsController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Historical/reporting endpoints behind the Analytics page - Manager+
// only, same tier as dashboardController's summary/activity/headcount
// (oversight-tier reporting, not everyday operational visibility).
router.get('/sla-compliance', authenticate, requireStaffRole('Manager'), controller.slaCompliance);
router.get('/approval-turnaround', authenticate, requireStaffRole('Manager'), controller.approvalTurnaround);
router.get('/offer-outcomes', authenticate, requireStaffRole('Manager'), controller.offerOutcomes);
router.get('/hiring-mix', authenticate, requireStaffRole('Manager'), controller.hiringMix);
router.get('/time-to-fill', authenticate, requireStaffRole('Manager'), controller.timeToFill);
router.get('/delegation-activity', authenticate, requireStaffRole('Manager'), controller.delegationActivity);
router.get('/panel-workload', authenticate, requireStaffRole('Manager'), controller.panelWorkload);

module.exports = router;
