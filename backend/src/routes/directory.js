const express = require('express');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const controller = require('../controllers/directoryController');

const router = express.Router();

router.get('/people', authenticate, requireStaffRole('HR_Officer'), controller.searchPeople);

module.exports = router;
