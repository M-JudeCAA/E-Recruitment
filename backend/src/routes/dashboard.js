const express = require('express');
const controller = require('../controllers/dashboardController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Executive dashboard - Manager/Director tier only. Every HR Officer+
// screen this data could theoretically also serve already exists
// (HRHome's own KPI cards); this is specifically the oversight/approvals
// view, so it's gated at the same tier as the approval actions it
// surfaces (vacancy approve, offer approve) rather than opened to
// everyone.
router.get('/summary', authenticate, requireStaffRole('Manager'), controller.summary);
router.get('/activity', authenticate, requireStaffRole('Manager'), controller.activity);
router.get('/headcount-by-directorate', authenticate, requireStaffRole('Manager'), controller.headcountByDirectorate);

module.exports = router;
