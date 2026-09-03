const express = require('express');
const controller = require('../controllers/departmentController');
const positionController = require('../controllers/positionController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.propose);
router.get('/approved', authenticate, requireStaffRole('HR_Officer'), controller.listApproved);
router.get('/pending', authenticate, requireStaffRole('Principal_HR_Officer'), controller.listPending);
router.get('/admin', authenticate, requireStaffRole('Principal_HR_Officer'), controller.listAllForAdmin);
router.patch('/:id/approve', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approve);
router.patch('/:id/reject', authenticate, requireStaffRole('Principal_HR_Officer'), controller.reject);
// NEW - positions scoped to one department, for the vacancy form's
// second-step dropdown (department chosen first, then a short list of
// just that department's positions, not the full org-wide list).
router.get('/:id/positions', authenticate, requireStaffRole('HR_Officer'), positionController.listByDepartment);

module.exports = router;
