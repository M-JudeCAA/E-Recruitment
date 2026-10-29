const express = require('express');
const controller = require('../controllers/auditController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// Any HR staff member can see the history of what they can already see.
router.get('/organisation', authenticate, requireStaffRole('HR_Officer'), controller.organisation);
router.get('/:entityType/:entityId', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.auditEntity()), controller.history);
// Who viewed a candidate's data - Senior HR Officers and above review it.
router.get('/access/applications/:applicationId', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.application('applicationId')), controller.access);

module.exports = router;
