const express = require('express');
const controller = require('../controllers/candidateAuthController');
const { authLimiters } = require('../middleware/rateLimit');

const router = express.Router();
// Limits attempts per network address and per account - see middleware/rateLimit.js.
const limit = authLimiters('candidate');

router.post('/register', limit.register, controller.register);
router.get('/confirm-email', controller.confirmEmail);
router.post('/login', limit.login, controller.login);
router.post('/forgot-password', limit.forgotPassword, controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
