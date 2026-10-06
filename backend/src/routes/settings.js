const express = require('express');
const { authenticate, requireSystemAdminOrRole } = require('../middleware/auth');
const controller = require('../controllers/settingsController');

const router = express.Router();
const gate = [authenticate, requireSystemAdminOrRole('Manager')];

router.get('/', ...gate, controller.list);
router.put('/:key', ...gate, controller.update);

module.exports = router;
