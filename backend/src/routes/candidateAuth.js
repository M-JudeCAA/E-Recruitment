const express = require('express');
const controller = require('../controllers/candidateAuthController');
const { authLimiters } = require('../middleware/rateLimit');
const { casing } = require('../utils/textCase');
const { requireExternalSiteOpen: open } = require('../config/externalSite');

const router = express.Router();
// Limits attempts per network address and per account - see middleware/rateLimit.js.
const limit = authLimiters('candidate');

// Password accounts are the public careers site's; they wait while it is closed (config/externalSite.js).
router.post('/register', open, limit.register, casing({ fullName: 'name', email: 'email' }), controller.register);
router.get('/confirm-email', open, limit.tokenUse, controller.confirmEmail);
router.post('/login', open, limit.login, controller.login);
// Internal candidates: sign in with a UCAA Microsoft account.
router.post('/entra', limit.entra, controller.entraLogin);
router.post('/forgot-password', open, limit.forgotPassword, controller.forgotPassword);
router.post('/reset-password', open, limit.tokenUse, controller.resetPassword);

module.exports = router;
