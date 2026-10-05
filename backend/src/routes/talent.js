const express = require('express');
const controller = require('../controllers/talentController');
const { authenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// The candidate database: tags and keyword search (FR-ATS-051/052). Any HR
// tier reads and tags; deleting a tag outright is Senior HR Officer+.
const hr = [authenticate, requireStaffRole('HR_Officer')];

router.get('/tags', ...hr, controller.listTags);
router.post('/tags', ...hr, controller.createTag);
router.delete('/tags/:tagId', authenticate, requireStaffRole('Senior_HR_Officer'), controller.deleteTag);
router.get('/candidates', ...hr, controller.search);
router.post('/candidates/:candidateId/tags', ...hr, guardVacancy(vacancyFrom.candidate('candidateId')), controller.addTag);
router.delete('/candidates/:candidateId/tags/:tagId', ...hr, guardVacancy(vacancyFrom.candidate('candidateId')), controller.removeTag);

module.exports = router;
