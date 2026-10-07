const express = require('express');
const controller = require('../controllers/directorateController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('Principal_HR_Officer'), controller.create);
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.list);
router.get('/pending', authenticate, requireStaffRole('Principal_HR_Officer'), controller.listPending);
router.patch('/:id/approve', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approve);
router.patch('/:id/reject', authenticate, requireStaffRole('Principal_HR_Officer'), controller.reject);
// Editing and deleting: who may is decided per item (orgAdminService) -
// PHRO+, or whoever added it while it is still pending.
router.patch('/:id', authenticate, requireStaffRole('HR_Officer'), controller.update);
router.delete('/:id', authenticate, requireStaffRole('HR_Officer'), controller.remove);

module.exports = router;
