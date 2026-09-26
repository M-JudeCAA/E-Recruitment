const express = require('express');
const controller = require('../controllers/panelAccessController');

const router = express.Router();

router.get('/:token', controller.viewByToken);
router.patch('/:token/score', controller.submitByToken);
// The panelist declares a conflict of interest and stands down, using the same link.
router.patch('/:token/recuse', controller.recuseByToken);

module.exports = router;
