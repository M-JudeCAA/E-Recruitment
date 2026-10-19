const express = require('express');
const controller = require('../controllers/notificationController');
const { authenticate, requireSystemAdminOrRole } = require('../middleware/auth');

const router = express.Router();

// Anyone in HR, and system administrators (who are told about staff app
// access problems) - each only ever reads their own.
const staffOrAdmin = requireSystemAdminOrRole('HR_Officer');
router.get('/mine', authenticate, staffOrAdmin, controller.listMine);
router.patch('/read-all', authenticate, staffOrAdmin, controller.markAllRead);
router.patch('/:id/read', authenticate, staffOrAdmin, controller.markRead);

module.exports = router;
