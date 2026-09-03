const express = require('express');
const controller = require('../controllers/interviewController');
const panelAccessController = require('../controllers/panelAccessController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Interview scheduling/scoring/finalizing is downstream of shortlisting,
// so it sits at the same Senior HR Officer+ tier as "Review & shortlist
// candidates" in the 5-tier permission table.
router.post('/applications/:applicationId/interviews', authenticate, requireStaffRole('Senior_HR_Officer'), controller.schedule);
router.post('/:interviewId/panel-members', authenticate, requireStaffRole('Senior_HR_Officer'), controller.addPanelMember);
router.patch('/panel-members/:panelMemberId/score', authenticate, requireStaffRole('Senior_HR_Officer'), controller.recordPanelScore);
router.patch('/:interviewId/finalize', authenticate, requireStaffRole('Senior_HR_Officer'), controller.finalizeRecommendation);
router.post('/panel-members/:panelMemberId/access-link', authenticate, requireStaffRole('Senior_HR_Officer'), panelAccessController.generateLink);
router.patch('/panel-members/:panelMemberId/revoke-access', authenticate, requireStaffRole('Senior_HR_Officer'), panelAccessController.revokeAccess);

module.exports = router;
