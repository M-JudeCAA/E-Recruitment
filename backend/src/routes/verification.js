const express = require('express');
const controller = require('../controllers/verificationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// "Verify internal candidate employment" is Senior HR Officer+ per the
// 5-tier permission table.
router.patch('/candidates/:candidateId/verify', authenticate, requireStaffRole('Senior_HR_Officer'),
  upload.single('recommendationLetter'), controller.verify
);

module.exports = router;
