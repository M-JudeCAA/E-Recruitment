const express = require('express');
const controller = require('../controllers/auditController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// Any HR staff member can see the history of what they can already see.
router.get('/:entityType/:entityId', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.auditEntity()), controller.history);
// Who viewed a candidate's data is for managers to review, not the HR team
// whose access it records.
router.get('/access/applications/:applicationId', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.application('applicationId')), controller.access);

module.exports = router;
