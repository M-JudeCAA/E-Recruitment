const express = require('express');
const controller = require('../controllers/analyticsController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// The trend charts under the recruitment dashboard. The organisation-level
// ones are open to all HR staff; the two about individual staff members -
// each approver's turnaround and who acted under whose delegation - are
// Senior HR Officer+.
router.get('/sla-compliance', authenticate, requireStaffRole('HR_Officer'), controller.slaCompliance);
router.get('/approval-turnaround', authenticate, requireStaffRole('Senior_HR_Officer'), controller.approvalTurnaround);
router.get('/offer-outcomes', authenticate, requireStaffRole('HR_Officer'), controller.offerOutcomes);
router.get('/hiring-mix', authenticate, requireStaffRole('HR_Officer'), controller.hiringMix);
router.get('/time-to-fill', authenticate, requireStaffRole('HR_Officer'), controller.timeToFill);
router.get('/delegation-activity', authenticate, requireStaffRole('Senior_HR_Officer'), controller.delegationActivity);
router.get('/panel-workload', authenticate, requireStaffRole('HR_Officer'), controller.panelWorkload);

// The recruitment dashboard (FR-ATS-070 to 074), filterable and exportable,
// for all HR staff (vacancies the viewer applied for are left out).
const recruitment = require('../controllers/recruitmentMetricsController');
router.get('/recruitment', authenticate, requireStaffRole('HR_Officer'), recruitment.get);
router.get('/recruitment/export', authenticate, requireStaffRole('HR_Officer'), recruitment.exportCsv);

module.exports = router;
