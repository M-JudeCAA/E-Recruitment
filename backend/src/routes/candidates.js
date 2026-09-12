const express = require('express');
const controller = require('../controllers/candidateController');
const notificationController = require('../controllers/candidateNotificationController');
const cvParseController = require('../controllers/cvParseController');
const { authenticate, requireCandidate } = require('../middleware/auth');
const { uploadMemory } = require('../middleware/uploadMemory');
const { uploadPhoto } = require('../middleware/upload');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// asyncHandler wraps every action here so a rejected promise (e.g. a
// transient database error) reaches the error-handling middleware in
// server.js and returns a real 500 to the caller, rather than an
// unhandled rejection that only the process-wide safety net in
// server.js catches - which keeps the server alive but leaves this one
// request hanging with no response at all.
router.get('/me', authenticate, requireCandidate, asyncHandler(controller.me));
router.put('/me', authenticate, requireCandidate, asyncHandler(controller.updateProfile));
router.post('/me/work-experience', authenticate, requireCandidate, asyncHandler(controller.addWorkExperience));
router.put('/me/work-experience/:id', authenticate, requireCandidate, asyncHandler(controller.updateWorkExperience));
router.delete('/me/work-experience/:id', authenticate, requireCandidate, asyncHandler(controller.deleteWorkExperience));
router.post('/me/education', authenticate, requireCandidate, asyncHandler(controller.addEducation));
router.put('/me/education/:id', authenticate, requireCandidate, asyncHandler(controller.updateEducation));
router.delete('/me/education/:id', authenticate, requireCandidate, asyncHandler(controller.deleteEducation));
router.post('/me/certificates', authenticate, requireCandidate, asyncHandler(controller.addCertificate));
router.put('/me/certificates/:id', authenticate, requireCandidate, asyncHandler(controller.updateCertificate));
router.delete('/me/certificates/:id', authenticate, requireCandidate, asyncHandler(controller.deleteCertificate));
router.put('/me/internal-profile', authenticate, requireCandidate, asyncHandler(controller.updateInternalProfile));
router.put('/me/photo', authenticate, requireCandidate, uploadPhoto.single('photo'), asyncHandler(controller.updatePhoto));
router.delete('/me/photo', authenticate, requireCandidate, asyncHandler(controller.removePhoto));
router.get('/me/applications', authenticate, requireCandidate, asyncHandler(controller.myApplications));
router.get('/me/notifications', authenticate, requireCandidate, asyncHandler(notificationController.listMine));
router.patch('/me/notifications/:id/read', authenticate, requireCandidate, asyncHandler(notificationController.markRead));
router.post('/me/parse-cv', authenticate, requireCandidate, uploadMemory.single('cv'), asyncHandler(cvParseController.parseCv));

module.exports = router;
