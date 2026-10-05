const express = require('express');
const controller = require('../controllers/applicationController');
const draftController = require('../controllers/applicationDraftController');
const meritListController = require('../controllers/meritListController');
const exportController = require('../controllers/exportController');
const offerController = require('../controllers/offerController');
const { authenticate, requireStaffRole, requireCandidate } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');
const { upload, uploadSupportingDocument } = require('../middleware/upload');

const router = express.Router();

// Same HR_Officer+ gate as vacancies/:id/applications (the per-vacancy
// equivalent this aggregates across all vacancies).
router.get('/count', authenticate, requireStaffRole('HR_Officer'), controller.count);
// The Application Management cross-vacancy queue - filtered/paginated list,
// same tier as /count and /api/vacancies/:id/applications.
router.get('/', authenticate, requireStaffRole('HR_Officer'), controller.list);

// REPLACES the old single-step submit() entirely (was the old one-step
// controller.submit). saveDraft() handles both first-save and every
// subsequent edit to that same draft.
router.post('/', authenticate, requireCandidate,
  upload.fields([{ name: 'coverLetter', maxCount: 1 }]),
  draftController.saveDraft
);
// The explicit "I'm done, submit this" action.
router.patch('/:id/submit', authenticate, requireCandidate, draftController.submit);
// Candidate withdraws their own Draft or Submitted application.
router.patch('/:id/withdraw', authenticate, requireCandidate, draftController.withdraw);
// Screening at the point of application - may this candidate apply to this
// vacancy? submit() enforces the same rules.
router.get('/eligibility/:vacancyId', authenticate, requireCandidate, draftController.eligibility);
// Academic and other supporting documents on the candidate's own Draft.
router.post('/:id/documents', authenticate, requireCandidate,
  uploadSupportingDocument.single('file'),
  draftController.addDocument
);
router.delete('/:id/documents/:documentId', authenticate, requireCandidate, draftController.removeDocument);

// "Review & shortlist candidates" is a Senior HR Officer+ capability per
// the 5-tier permission table - an HR Officer can create/propose but not
// review/shortlist.
router.patch('/:id/shortlist', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.application('id')), controller.shortlist);
// Formal rejection - the only staff-driven way to reach ApplicationStatus
// Rejected (the other is interviewController.recordResults, when
// the panel's own recommendation is "Reject"). Same tier as shortlist.
router.patch('/:id/reject', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.application('id')), controller.reject);
router.post('/vacancies/:vacancyId/approve-shortlist', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.param('vacancyId')), controller.approveShortlist);
// The post-interview merit list (meritListController) - same tiers as the
// interview shortlist: read by any HR tier, proposed by Senior_HR_Officer+,
// approved by Principal_HR_Officer+ (never the proposer).
router.get('/merit-lists/pending-approval', authenticate, requireStaffRole('Principal_HR_Officer'), meritListController.listPendingApproval);
router.get('/vacancies/:vacancyId/merit-list', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('vacancyId')), meritListController.getBoard);
router.post('/vacancies/:vacancyId/merit-list', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.param('vacancyId')), meritListController.propose);
router.get('/vacancies/:vacancyId/merit-list/export', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('vacancyId')), exportController.meritList);
router.post('/vacancies/:vacancyId/merit-list/approve', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.param('vacancyId')), meritListController.approve);
// Offers (offerController, lifecycle in offerService.js). Principal HR
// Officer+ drafts, revises and withdraws; Manager/Director approve or return
// (Decision #10: PHRO can recommend but never approve); only the owning
// candidate accepts or declines. Reading is open to every HR tier.
router.get('/offers/export', authenticate, requireStaffRole('HR_Officer'), exportController.offers);
router.get('/offers', authenticate, requireStaffRole('HR_Officer'), offerController.list);
router.get('/offers/pending-approval', authenticate, requireStaffRole('Manager'), offerController.listPendingApproval);
router.get('/:id/offer-draft', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.application('id')), offerController.draft);
// Only for a Primary candidate on an approved merit list.
router.post('/:id/recommend-offer', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.application('id')), offerController.recommend);
router.patch('/offers/:offerId', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), offerController.revise);
router.patch('/offers/:offerId/approve', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.offer('offerId')), offerController.approve);
router.patch('/offers/:offerId/return', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.offer('offerId')), offerController.returnForRevision);
router.patch('/offers/:offerId/accept', authenticate, requireCandidate, offerController.accept);
router.patch('/offers/:offerId/decline', authenticate, requireCandidate, offerController.decline);
router.patch('/offers/:offerId/withdraw', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), offerController.withdraw);
// Mark as Hired (FR-ATS-067): one onboarding case per accepted offer.
const hireController = require('../controllers/hireController');
const { uploadSignedAppointment } = require('../middleware/upload');
router.get('/hires/export', authenticate, requireStaffRole('HR_Officer'), exportController.hires);
router.get('/hires', authenticate, requireStaffRole('HR_Officer'), hireController.list);
router.post('/offers/:offerId/hire', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), uploadSignedAppointment.single('signedInstrument'), hireController.markHired);
router.get('/offers/:offerId/hire', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), hireController.get);
router.get('/offers/:offerId/hire/package', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), hireController.downloadPackage);
router.post('/offers/:offerId/hire/retry', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.offer('offerId')), hireController.retry);

module.exports = router;
