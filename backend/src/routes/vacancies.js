const express = require('express');
const controller = require('../controllers/vacancyController');
const { authenticate, optionalAuthenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.patch('/:id', authenticate, requireStaffRole('HR_Officer'), controller.update);
router.patch('/:id/close', authenticate, requireStaffRole('Principal_HR_Officer'), controller.close);
router.patch('/:id/approve', authenticate, requireStaffRole('Principal_HR_Officer'), controller.approve);
router.get('/', optionalAuthenticate, controller.listPublic);
router.get('/admin', authenticate, requireStaffRole('HR_Officer'), controller.listForAdmin);
router.get('/:id', controller.getOne);
router.get('/:id/applications', authenticate, requireStaffRole('HR_Officer'), controller.listApplications);
// Saving a shortlist ranking is the actual "review & shortlist candidates"
// action, so it requires Senior HR Officer+, same as shortlist/interview
// routes - unlike listApplications just above, which is a read-only view.
router.post('/:id/rank', authenticate, requireStaffRole('Senior_HR_Officer'), controller.saveRanking);

module.exports = router;
