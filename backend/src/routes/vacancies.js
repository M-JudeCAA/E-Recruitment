const express = require('express');
const controller = require('../controllers/vacancyController');
const exportController = require('../controllers/exportController');
const requisitionController = require('../controllers/requisitionController');
const { uploadRequisition } = require('../middleware/upload');
const batchController = require('../controllers/vacancyReviewBatchController');
const { authenticate, optionalAuthenticate, requireStaffRole } = require('../middleware/auth');
const { guardVacancy, vacancyFrom } = require('../middleware/applicantConflict');

const router = express.Router();

// Step 1 of creating a vacancy: upload the EXCO-approved, signed requisition
// and get the form pre-filled from it. create() refuses without one.
router.post('/requisition', authenticate, requireStaffRole('HR_Officer'), uploadRequisition.single('document'), requisitionController.read);
router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.patch('/:id', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.update);
router.patch('/:id/close', authenticate, requireStaffRole('Principal_HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.close);
// REMOVED: the /:id/review route (and its Senior HR Officer check-by
// gate) - the vacancy workflow simplified from 5-tier to 2-tier, and the
// new flow has no review step. This scoping is deliberately narrow: only
// vacancy approval changed. Application screening's Begin Review (below)
// is a separate, unrelated feature and is untouched.
router.patch('/:id/begin-review', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.param('id')), batchController.beginReview);
// CHANGED: was Principal_HR_Officer. The new 2-tier flow is HR Officer
// creates, then Manager or Director approves directly - matching "MHRA
// or DHRA" exactly. Cumulative rank means Director can also reach this,
// consistent with every other minRole gate in this app.
router.patch('/:id/approve', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.param('id')), controller.approve);
// The approver's other answers - both need a comment (FR-ATS-009). A
// returned vacancy is revised and resubmitted by HR; a rejected one is final.
router.patch('/:id/return', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.param('id')), controller.returnForRevision);
router.patch('/:id/reject', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.param('id')), controller.reject);
router.patch('/:id/resubmit', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.resubmit);
// NEW - Internal <-> External transition. Same tier as approval itself:
// only Manager/Director can call this at all, which is what makes their
// call to it constitute the required approval - no separate propose step.
router.patch('/:id/transition-posting-type', authenticate, requireStaffRole('Manager'), guardVacancy(vacancyFrom.param('id')), controller.transitionPostingType);
// NEW - readvertise a closed vacancy as a brand new one. Same tier as
// create(), since this is functionally "create a new vacancy" (it goes
// through PendingApproval -> approve again, not a direct reopen).
router.post('/:id/readvertise', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.readvertise);
router.get('/', optionalAuthenticate, controller.listPublic);
router.get('/admin', authenticate, requireStaffRole('HR_Officer'), controller.listForAdmin);
// optionalAuthenticate (not plain, unauthenticated) so getOne can tell a
// staff caller (staffApiClient always sends a Bearer token) from a
// candidate/guest one and hide HR-only fields accordingly - see that
// function's own comment.
router.get('/:id', optionalAuthenticate, controller.getOne);
router.get('/:id/applications', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.listApplications);
// Spreadsheet of every applicant - the shortlisting report (FR-ATS-053).
router.get('/:id/export/shortlisting-report', authenticate, requireStaffRole('HR_Officer'), guardVacancy(vacancyFrom.param('id')), exportController.shortlistReport);
// Saving a shortlist ranking is the actual "review & shortlist candidates"
// action, so it requires Senior HR Officer+, same as shortlist/interview
// routes - unlike listApplications just above, which is a read-only view.
router.post('/:id/rank', authenticate, requireStaffRole('Senior_HR_Officer'), guardVacancy(vacancyFrom.param('id')), controller.saveRanking);

module.exports = router;
