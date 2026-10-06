const express = require('express');
const { authenticate, requireSystemAdminOrRole } = require('../middleware/auth');
const controller = require('../controllers/directoryController');

const router = express.Router();

// HR (hiring managers) and system administrators (picking who gets a staff
// account - an accounts-only administrator holds no HR role).
router.get('/people', authenticate, requireSystemAdminOrRole('HR_Officer'), controller.searchPeople);

module.exports = router;
