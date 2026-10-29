const express = require('express');
const controller = require('../controllers/verificationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Internal candidates waiting for HR's employment check (the Employment
// checks page, and its Inbox item) - anyone in HR sees it and decides it
// (never their own).
router.get('/pending', authenticate, requireStaffRole('HR_Officer'), controller.pending);
router.patch('/candidates/:candidateId/verify', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.candidate('candidateId')),
  upload.single('recommendationLetter'), controller.verify
);

module.exports = router;
