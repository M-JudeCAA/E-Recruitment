const express = require('express');
const controller = require('../controllers/staffUserController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('Principal_HR_Officer'), controller.create);
router.patch('/:id/role', authenticate, requireStaffRole('Principal_HR_Officer'), controller.updateRole);
// The staff accounts admin screen itself is Principal HR Officer+ only,
// but the underlying directory (name/email/role, nothing sensitive)
// also has one other legitimate caller: a Senior HR Officer authorizing
// a delegation needs to look up who's eligible as their delegate. Senior
// HR Officer+ is therefore the true floor for this endpoint, not PHRO+.
router.get('/', authenticate, requireStaffRole('Senior_HR_Officer'), controller.list);

module.exports = router;
