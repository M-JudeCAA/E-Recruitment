const express = require('express');
const controller = require('../controllers/directorateController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('Principal_HR_Officer'), controller.create);
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.list);

module.exports = router;
