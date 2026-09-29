const express = require('express');
const controller = require('../controllers/shortlistCommitteeController');
const { authenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

// HR's side of a vacancy's shortlisting committee. Read by any HR tier;
// running it is Senior HR Officer+, the same tier as "Review & shortlist
// candidates". Approving the resulting shortlist stays with Principal HR
// Officers (POST /api/applications/vacancies/:vacancyId/approve-shortlist).
const read = [authenticate, requireStaffRole('HR_Officer')];
const write = [authenticate, requireStaffRole('Senior_HR_Officer')];

router.get('/vacancies/:vacancyId', ...read, controller.get);
router.post('/vacancies/:vacancyId', ...write, controller.create);
router.patch('/vacancies/:vacancyId', ...write, controller.update);
router.post('/vacancies/:vacancyId/members', ...write, controller.addMember);
router.patch('/vacancies/:vacancyId/members/:memberId', ...write, controller.updateMember);
router.delete('/vacancies/:vacancyId/members/:memberId', ...write, controller.removeMember);
router.post('/vacancies/:vacancyId/members/:memberId/link', ...write, controller.reissueLink);
router.post('/vacancies/:vacancyId/open', ...write, controller.openRating);
router.post('/vacancies/:vacancyId/assignments', ...write, controller.addAssignment);
router.put('/vacancies/:vacancyId/acting-chairs', ...write, controller.setActingChair);
router.post('/vacancies/:vacancyId/moderation', ...write, controller.startModeration);
router.post('/vacancies/:vacancyId/close', ...write, controller.close);
router.post('/vacancies/:vacancyId/propose', ...write, controller.propose);

module.exports = router;
