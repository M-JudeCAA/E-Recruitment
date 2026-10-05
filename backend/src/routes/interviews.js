const express = require('express');
const controller = require('../controllers/interviewController');
const panelAccessController = require('../controllers/panelAccessController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

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
router.get('/vacancies/:vacancyId/scheduling-context', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.schedulingContext);
router.get('/vacancies/:vacancyId/scorecard', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.scorecard);
router.post('/vacancies/:vacancyId/plan', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.planSession);
router.post('/vacancies/:vacancyId/sessions', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.scheduleSession);
router.post('/applications/:applicationId/interviews', ...write, guardVacancy(vacancyFrom.application('applicationId')), controller.schedule);
// One vacancy's interview day, run as a session: HR starts it, calls each
// candidate in (which opens them for scoring on the panel's day links), and
// ends it (15-minute grace, then the links close).
router.get('/vacancies/:vacancyId/days/:day', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.getDay);
router.post('/vacancies/:vacancyId/days/:day/start', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.startDay);
router.post('/vacancies/:vacancyId/days/:day/end', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.endDay);

router.patch('/panel-members/:panelMemberId', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.updatePanelMember);
router.delete('/panel-members/:panelMemberId', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.removePanelMember);
router.patch('/panel-members/:panelMemberId/recuse', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.recusePanelMember);
router.patch('/panel-members/:panelMemberId/score', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.recordPanelScore);
router.post('/panel-members/:panelMemberId/access-link', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), panelAccessController.generateLink);
router.patch('/panel-members/:panelMemberId/revoke-access', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), panelAccessController.revokeAccess);

router.get('/:interviewId', ...read, guardVacancy(vacancyFrom.interview('interviewId')), controller.getById);
router.get('/:interviewId/calendar.ics', ...read, guardVacancy(vacancyFrom.interview('interviewId')), controller.calendarFile);
router.patch('/:interviewId', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.update);
router.patch('/:interviewId/reschedule', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.reschedule);
router.patch('/:interviewId/cancel', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.cancel);
router.patch('/:interviewId/no-show', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.markNoShow);
router.patch('/:interviewId/call-in', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.callIn);
router.post('/:interviewId/panel-members', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.addPanelMember);
router.post('/:interviewId/access-links', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.sendAllLinks);
router.patch('/:interviewId/finalize', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.finalizeRecommendation);

module.exports = router;
