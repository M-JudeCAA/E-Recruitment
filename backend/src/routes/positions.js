const express = require('express');
const controller = require('../controllers/positionController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.listForDropdown);
router.get('/:id/senior-options', authenticate, requireStaffRole('HR_Officer'), controller.listSeniorOptions);

module.exports = router;
