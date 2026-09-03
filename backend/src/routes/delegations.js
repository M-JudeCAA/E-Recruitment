const express = require('express');
const controller = require('../controllers/delegationController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Self-service delegation of one's own authority - Senior HR Officer+
// only, since an HR Officer has no tier below them to delegate to (the
// controller's tierBelow check would 422 anyway, but gating the route
// keeps an HR Officer from reaching this feature at all).
router.post('/', authenticate, requireStaffRole('Senior_HR_Officer'), controller.create);

// Senior HR Officer+ can see this list - the controller itself narrows
// what's returned (own delegations only, vs. full oversight for
// Principal HR Officer+).
router.get('/', authenticate, requireStaffRole('Senior_HR_Officer'), controller.list);

module.exports = router;
