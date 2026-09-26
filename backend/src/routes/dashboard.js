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
router.get('/sla-policies', authenticate, requireStaffRole('Manager'), controller.slaPolicies);

// Open to every HR tier (not just Manager+), unlike the Manager-only
// endpoints above - the pending-task queues /follow-ups reports on are
// already org-wide visibility on ApprovalsCenter, and both HRHome's
// "Follow-ups" panel and its applications-sparkline (fed by /trends) need
// this data read-only for tiers below Manager. Only the approve/reject
// actions themselves stay Manager+/tier-gated.
router.get('/trends', authenticate, requireStaffRole('HR_Officer'), controller.trends);
router.get('/follow-ups', authenticate, requireStaffRole('HR_Officer'), controller.followUps);
router.get('/upcoming-interviews', authenticate, requireStaffRole('HR_Officer'), controller.upcomingInterviews);
router.get('/screening-breakdown', authenticate, requireStaffRole('HR_Officer'), controller.screeningBreakdown);
// Every staff tier sees the same system warnings - they affect everyone's work.
router.get('/system-health', authenticate, requireStaffRole('HR_Officer'), controller.systemHealth);

module.exports = router;
