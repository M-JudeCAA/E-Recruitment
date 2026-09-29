const express = require('express');
const controller = require('../controllers/panelDayController');

const router = express.Router();

// Public - a panelist's day link (see panelDayLinkService.js).
router.get('/:token', controller.view);
router.patch('/:token/score', controller.score);
router.patch('/:token/recuse', controller.recuse);

module.exports = router;
