const express = require('express');
const controller = require('../controllers/shortlistCommitteeController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// HR's side of a vacancy's shortlisting committee. Read by any HR tier;
// running it is Senior HR Officer+, the same tier as "Review & shortlist
// candidates". Approving the resulting shortlist stays with Principal HR
// Officers (POST /api/applications/vacancies/:vacancyId/approve-shortlist).
const read = [authenticate, requireStaffRole('HR_Officer')];
const write = [authenticate, requireStaffRole('Senior_HR_Officer')];

// The nomination: HR submits it; the DHRA (a Director) approves or returns it.
const dhra = [authenticate, requireStaffRole('Director')];
router.get('/nominations/pending', ...dhra, controller.pendingNominations);
router.post('/vacancies/:vacancyId/nomination/submit', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.submitNomination);
router.post('/vacancies/:vacancyId/nomination/approve', ...dhra, guardVacancy(vacancyFrom.param('vacancyId')), controller.approveNomination);
router.post('/vacancies/:vacancyId/nomination/return', ...dhra, guardVacancy(vacancyFrom.param('vacancyId')), controller.returnNomination);

router.get('/vacancies/:vacancyId', ...read, guardVacancy(vacancyFrom.param('vacancyId')), controller.get);
router.post('/vacancies/:vacancyId', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.create);
router.patch('/vacancies/:vacancyId', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.update);
router.post('/vacancies/:vacancyId/members', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.addMember);
router.patch('/vacancies/:vacancyId/members/:memberId', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.updateMember);
router.delete('/vacancies/:vacancyId/members/:memberId', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.removeMember);
router.post('/vacancies/:vacancyId/members/:memberId/link', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.reissueLink);
router.post('/vacancies/:vacancyId/open', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.openRating);
router.post('/vacancies/:vacancyId/assignments', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.addAssignment);
router.put('/vacancies/:vacancyId/acting-chairs', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.setActingChair);
router.post('/vacancies/:vacancyId/moderation', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.startModeration);
router.post('/vacancies/:vacancyId/close', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.close);
router.post('/vacancies/:vacancyId/propose', ...write, guardVacancy(vacancyFrom.param('vacancyId')), controller.propose);

module.exports = router;
