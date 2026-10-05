const express = require('express');
const controller = require('../controllers/interviewController');
const { uploadSupportingDocument } = require('../middleware/upload');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// Reading the interview pipeline (agenda, what needs attention, one round,
// scorecards, calendar files) is everyday operational visibility, open to
// every HR tier - same reasoning as /api/dashboard/upcoming-interviews.
// Everything that changes an interview (scheduling, rescheduling, panel) is
// downstream of shortlisting, so it sits at the same Senior HR Officer+ tier
// as "Review & shortlist candidates". Recording the results is transcribing
// the panel's signed score sheet, which any HR Officer may do - a second
// person checks them against the sheet at the merit list.
const read = [authenticate, requireStaffRole('HR_Officer')];
const write = [authenticate, requireStaffRole('Senior_HR_Officer')];
const record = [authenticate, requireStaffRole('HR_Officer')];

// Fixed paths first - they would otherwise be captured by /:interviewId.
router.get('/', ...read, controller.list);
router.get('/attention', ...read, controller.attention);
router.get('/vacancies/:vacancyId/scheduling-context', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.schedulingContext);
router.get('/vacancies/:vacancyId/scorecard', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.scorecard);
router.post('/vacancies/:vacancyId/plan', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.planSession);
router.post('/vacancies/:vacancyId/sessions', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.scheduleSession);
router.post('/applications/:applicationId/interviews', ...write, guardVacancy(vacancyFrom.application('applicationId')), controller.schedule);
router.patch('/panel-members/:panelMemberId', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.updatePanelMember);
router.delete('/panel-members/:panelMemberId', ...write, guardVacancy(vacancyFrom.panelMember('panelMemberId')), controller.removePanelMember);

router.get('/:interviewId', ...read, guardVacancy(vacancyFrom.interview('interviewId')), controller.getById);
router.get('/:interviewId/calendar.ics', ...read, guardVacancy(vacancyFrom.interview('interviewId')), controller.calendarFile);
router.patch('/:interviewId', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.update);
router.patch('/:interviewId/reschedule', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.reschedule);
router.patch('/:interviewId/cancel', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.cancel);
router.patch('/:interviewId/no-show', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.markNoShow);
router.post('/:interviewId/panel-members', ...write, guardVacancy(vacancyFrom.interview('interviewId')), controller.addPanelMember);
// The panel's results from its signed score sheet (multipart: score,
// recommendation, notes, scoreSheet) - first entry and later corrections.
router.patch('/:interviewId/results', ...record, guardVacancy(vacancyFrom.interview('interviewId')), uploadSupportingDocument.single('scoreSheet'), controller.recordResults);

module.exports = router;
