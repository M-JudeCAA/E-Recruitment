const express = require('express');
const controller = require('../controllers/verificationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.patch('/candidates/:candidateId/verify', authenticate, requireStaffRole('HR_Officer'),
  upload.single('recommendationLetter'), controller.verify
);

module.exports = router;
