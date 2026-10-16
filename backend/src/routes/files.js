const express = require('express');
const controller = require('../controllers/fileController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// The viewer's content - fetched with the Authorization header, so it does
// not take the ?token= the file itself accepts (CLAUDE.md, File access).
router.get('/:filename/preview', authenticate, controller.preview);
router.get('/:filename', controller.authenticateFromHeaderOrQuery, controller.serve);

module.exports = router;
