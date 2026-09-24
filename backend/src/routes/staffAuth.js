const express = require('express');
const controller = require('../controllers/staffAuthController');
const { authLimiters } = require('../middleware/rateLimit');

const router = express.Router();
// Limits attempts per network address and per account - see middleware/rateLimit.js.
const limit = authLimiters('staff');

router.post('/login', limit.login, controller.login);
router.post('/forgot-password', limit.forgotPassword, controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
