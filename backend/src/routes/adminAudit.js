const express = require('express');
const controller = require('../controllers/adminAuditController');
const { authenticate, requireSystemAdmin } = require('../middleware/auth');

// The audit log - who did what, when and from where. System administrators
// only.
const router = express.Router();

router.get('/meta', authenticate, requireSystemAdmin(), controller.meta);
router.get('/:kind/export', authenticate, requireSystemAdmin(), controller.exportCsv);
router.get('/:kind', authenticate, requireSystemAdmin(), controller.list);

module.exports = router;
