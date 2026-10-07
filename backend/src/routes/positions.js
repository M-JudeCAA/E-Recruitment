const express = require('express');
const controller = require('../controllers/positionController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.listForDropdown);
router.get('/pending', authenticate, requireStaffRole('Principal_HR_Officer'), controller.listPending);
router.patch('/:id/approve', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approve);
router.patch('/:id/reject', authenticate, requireStaffRole('Principal_HR_Officer'), controller.reject);
router.get('/:id/headcount', authenticate, requireStaffRole('HR_Officer'), controller.getHeadcount);
// The approved establishment is set by a Principal HR Officer or above.
router.put('/:id/headcount', authenticate, requireStaffRole('Principal_HR_Officer'), controller.setHeadcount);
router.get('/:id/senior-options', authenticate, requireStaffRole('HR_Officer'), controller.listSeniorOptions);

module.exports = router;
