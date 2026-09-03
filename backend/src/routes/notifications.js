const express = require('express');
const controller = require('../controllers/notificationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', authenticate, requireStaffRole('HR_Officer'), controller.listMine);
router.patch('/:id/read', authenticate, requireStaffRole('HR_Officer'), controller.markRead);

module.exports = router;
