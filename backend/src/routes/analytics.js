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

// The recruitment dashboard (FR-ATS-070 to 074), filterable and exportable.
const recruitment = require('../controllers/recruitmentMetricsController');
router.get('/recruitment', authenticate, requireStaffRole('Manager'), recruitment.get);
router.get('/recruitment/export', authenticate, requireStaffRole('Manager'), recruitment.exportCsv);

module.exports = router;
