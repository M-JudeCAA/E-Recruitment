const express = require('express');
const controller = require('../controllers/vacancyDraftController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Same tier as creating a vacancy. Each draft is visible only to its owner.
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.list);
router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.get('/:id', authenticate, requireStaffRole('HR_Officer'), controller.get);
router.put('/:id', authenticate, requireStaffRole('HR_Officer'), controller.update);
router.delete('/:id', authenticate, requireStaffRole('HR_Officer'), controller.remove);

module.exports = router;
