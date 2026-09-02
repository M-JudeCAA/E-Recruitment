const express = require('express');
const controller = require('../controllers/fileController');

const router = express.Router();

router.get('/:filename', controller.authenticateFromHeaderOrQuery, controller.serve);

module.exports = router;
