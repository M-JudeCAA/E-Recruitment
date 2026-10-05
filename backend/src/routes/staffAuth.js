const express = require('express');
const controller = require('../controllers/staffAuthController');
const { authLimiters } = require('../middleware/rateLimit');

const router = express.Router();
// Limits attempts per network address and per account - see middleware/rateLimit.js.
const limit = authLimiters('staff');

// Staff sign in with their UCAA Microsoft account; there are no staff
// passwords (and so no forgot/reset-password) any more.
router.post('/entra', limit.entra, controller.entraLogin);
// Break-glass system administrator sign-in, off unless BREAK_GLASS_LOGIN=true.
router.post('/login', limit.login, controller.login);

module.exports = router;
