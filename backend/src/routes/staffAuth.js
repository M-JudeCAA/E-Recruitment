const express = require('express');
const controller = require('../controllers/staffAuthController');

const router = express.Router();

router.post('/login', controller.login);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);

module.exports = router;
