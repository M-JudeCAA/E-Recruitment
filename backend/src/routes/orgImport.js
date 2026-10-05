const express = require('express');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { uploadSpreadsheet } = require('../middleware/uploadMemory');
const controller = require('../controllers/orgImportController');

const router = express.Router();

router.get('/template', authenticate, requireStaffRole('HR_Officer'), controller.template);
router.post('/preview', authenticate, requireStaffRole('HR_Officer'), uploadSpreadsheet.single('file'), controller.preview);
router.post('/', authenticate, requireStaffRole('HR_Officer'), uploadSpreadsheet.single('file'), controller.run);

module.exports = router;
