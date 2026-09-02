const express = require('express');
const controller = require('../controllers/candidateAuthController');

const router = express.Router();

router.post('/register', controller.register);
router.get('/confirm-email', controller.confirmEmail);
router.post('/login', controller.login);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
