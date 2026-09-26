const express = require('express');
const controller = require('../controllers/interviewController');
const panelAccessController = require('../controllers/panelAccessController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// Reading the interview pipeline (agenda, what needs attention, one round,
// scorecards, calendar files) is everyday operational visibility, open to
// every HR tier - same reasoning as /api/dashboard/upcoming-interviews.
// Everything that changes an interview (scheduling, rescheduling, panel,
// scores, finalizing) is downstream of shortlisting, so it sits at the same
// Senior HR Officer+ tier as "Review & shortlist candidates".
const read = [authenticate, requireStaffRole('HR_Officer')];
const write = [authenticate, requireStaffRole('Senior_HR_Officer')];

// Fixed paths first - they would otherwise be captured by /:interviewId.
router.get('/', ...read, controller.list);
router.get('/attention', ...read, controller.attention);
router.get('/vacancies/:vacancyId/scheduling-context', ...read, controller.schedulingContext);
router.get('/vacancies/:vacancyId/scorecard', ...read, controller.scorecard);
router.post('/vacancies/:vacancyId/plan', ...write, controller.planSession);
router.post('/vacancies/:vacancyId/sessions', ...write, controller.scheduleSession);
router.post('/applications/:applicationId/interviews', ...write, controller.schedule);

router.patch('/panel-members/:panelMemberId', ...write, controller.updatePanelMember);
router.delete('/panel-members/:panelMemberId', ...write, controller.removePanelMember);
router.patch('/panel-members/:panelMemberId/recuse', ...write, controller.recusePanelMember);
router.patch('/panel-members/:panelMemberId/score', ...write, controller.recordPanelScore);
router.post('/panel-members/:panelMemberId/access-link', ...write, panelAccessController.generateLink);
router.patch('/panel-members/:panelMemberId/revoke-access', ...write, panelAccessController.revokeAccess);

router.get('/:interviewId', ...read, controller.getById);
router.get('/:interviewId/calendar.ics', ...read, controller.calendarFile);
router.patch('/:interviewId', ...write, controller.update);
router.patch('/:interviewId/reschedule', ...write, controller.reschedule);
router.patch('/:interviewId/cancel', ...write, controller.cancel);
router.patch('/:interviewId/no-show', ...write, controller.markNoShow);
router.post('/:interviewId/panel-members', ...write, controller.addPanelMember);
router.post('/:interviewId/access-links', ...write, controller.sendAllLinks);
router.patch('/:interviewId/finalize', ...write, controller.finalizeRecommendation);

module.exports = router;
