const express = require('express');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');
const controller = require('../controllers/documentController');

const router = express.Router();
const read = [authenticate, requireStaffRole('HR_Officer')];
const edit = [authenticate, requireStaffRole('Manager')];

// Templates - anyone in HR can read them; HR Manager+ edits or resets.
router.get('/templates', ...read, controller.listTemplates);
router.get('/templates/:key', ...read, controller.getTemplate);
router.post('/templates/:key/preview', ...read, controller.previewTemplate);
router.put('/templates/:key', ...edit, controller.saveTemplate);
router.delete('/templates/:key', ...edit, controller.resetTemplate);

// Documents to print, filled from the record.
router.get('/offers/:offerId/offer-letter', ...read, guardVacancy(vacancyFrom.offer('offerId')), controller.offerLetter);
router.get('/offers/:offerId/appointment', ...read, guardVacancy(vacancyFrom.offer('offerId')), controller.appointmentInstrument);
router.get('/interviews/:interviewId/invitation', ...read, guardVacancy(vacancyFrom.interview('interviewId')), controller.interviewInvitation);
router.get('/applications/:applicationId/regret-letter', ...read, guardVacancy(vacancyFrom.application('applicationId')), controller.regretLetter);
router.get('/vacancies/:id/exco-shortlist', ...read, guardVacancy(vacancyFrom.param('id')), controller.excoShortlist);

module.exports = router;
