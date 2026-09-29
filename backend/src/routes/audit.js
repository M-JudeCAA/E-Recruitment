const express = require('express');
const controller = require('../controllers/auditController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Any HR staff member can see the history of what they can already see.
router.get('/:entityType/:entityId', authenticate, requireStaffRole('HR_Officer'), controller.history);

module.exports = router;
