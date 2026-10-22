const express = require('express');
const controller = require('../controllers/verificationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');
const { upload } = require('../middleware/upload');

const router = express.Router();

// "Verify internal candidate employment" is Senior HR Officer+ per the
// 5-tier permission table.
// Internal candidates waiting for HR's employment check (the Employment
// checks page, and its Inbox item) - anyone in HR sees it; deciding is
// Senior HR Officer+.
router.get('/pending', authenticate, requireStaffRole('HR_Officer'), controller.pending);
router.patch('/candidates/:candidateId/verify', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.candidate('candidateId')),
  upload.single('recommendationLetter'), controller.verify
);

module.exports = router;
