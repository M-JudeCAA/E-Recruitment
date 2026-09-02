const express = require('express');
const controller = require('../controllers/interviewController');
const panelAccessController = require('../controllers/panelAccessController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/applications/:applicationId/interviews', authenticate, requireStaffRole('HR_Officer'), controller.schedule);
router.post('/:interviewId/panel-members', authenticate, requireStaffRole('HR_Officer'), controller.addPanelMember);
router.patch('/panel-members/:panelMemberId/score', authenticate, requireStaffRole('HR_Officer'), controller.recordPanelScore);
router.patch('/:interviewId/finalize', authenticate, requireStaffRole('HR_Officer'), controller.finalizeRecommendation);
router.post('/panel-members/:panelMemberId/access-link', authenticate, requireStaffRole('HR_Officer'), panelAccessController.generateLink);
router.patch('/panel-members/:panelMemberId/revoke-access', authenticate, requireStaffRole('HR_Officer'), panelAccessController.revokeAccess);

module.exports = router;
