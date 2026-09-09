const express = require('express');
const controller = require('../controllers/vacancyController');
const batchController = require('../controllers/vacancyReviewBatchController');
const { authenticate, optionalAuthenticate, requireStaffRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, requireStaffRole('HR_Officer'), controller.create);
router.patch('/:id', authenticate, requireStaffRole('HR_Officer'), controller.update);
router.patch('/:id/close', authenticate, requireStaffRole('Principal_HR_Officer'), controller.close);
// REMOVED: the /:id/review route (and its Senior HR Officer check-by
// gate) - the vacancy workflow simplified from 5-tier to 2-tier, and the
// new flow has no review step. This scoping is deliberately narrow: only
// vacancy approval changed. Application screening's Begin Review (below)
// is a separate, unrelated feature and is untouched.
router.patch('/:id/begin-review', authenticate, requireStaffRole('Senior_HR_Officer'), batchController.beginReview);
// CHANGED: was Principal_HR_Officer. The new 2-tier flow is HR Officer
// creates, then Manager or Director approves directly - matching "MHRA
// or DHRA" exactly. Cumulative rank means Director can also reach this,
// consistent with every other minRole gate in this app.
router.patch('/:id/approve', authenticate, requireStaffRole('Manager'), controller.approve);
// NEW - Internal <-> External transition. Same tier as approval itself:
// only Manager/Director can call this at all, which is what makes their
// call to it constitute the required approval - no separate propose step.
router.patch('/:id/transition-posting-type', authenticate, requireStaffRole('Manager'), controller.transitionPostingType);
router.get('/', optionalAuthenticate, controller.listPublic);
router.get('/admin', authenticate, requireStaffRole('HR_Officer'), controller.listForAdmin);
router.get('/:id', controller.getOne);
router.get('/:id/applications', authenticate, requireStaffRole('HR_Officer'), controller.listApplications);
// Saving a shortlist ranking is the actual "review & shortlist candidates"
// action, so it requires Senior HR Officer+, same as shortlist/interview
// routes - unlike listApplications just above, which is a read-only view.
router.post('/:id/rank', authenticate, requireStaffRole('Senior_HR_Officer'), controller.saveRanking);

module.exports = router;
