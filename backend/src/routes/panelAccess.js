const express = require('express');
const controller = require('../controllers/panelAccessController');

const router = express.Router();

router.get('/:token', controller.viewByToken);
router.patch('/:token/score', controller.submitByToken);

module.exports = router;
