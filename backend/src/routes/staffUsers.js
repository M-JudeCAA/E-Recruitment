const express = require('express');
const controller = require('../controllers/staffUserController');
const { authenticate, requireStaffRole, requireSystemAdmin } = require('../middleware/auth');
const { casing } = require('../utils/textCase');

const router = express.Router();

// Account administration - system administrators only, whatever HR role
// anyone holds (see requireSystemAdmin).
router.get('/accounts', authenticate, requireSystemAdmin(), controller.listAccounts);
// People assigned to the staff app in Entra with no account yet.
router.get('/entra-assignments', authenticate, requireSystemAdmin(), controller.entraAssignments);
router.post('/', authenticate, requireSystemAdmin(), casing({ name: 'name', email: 'email' }), controller.create);
router.patch('/:id', authenticate, requireSystemAdmin(), casing({ name: 'name', email: 'email' }), controller.update);
router.post('/:id/unlink', authenticate, requireSystemAdmin(), controller.unlink);
// An HR Manager's team: the HR department's accounts and their HR roles -
// Manager+ by their own role, in the HR department (checked in the
// controller; a delegation isn't enough). No creating accounts.
router.get('/hr-team', authenticate, requireStaffRole('Manager'), controller.hrTeam);
router.patch('/hr-team/:id/role', authenticate, requireStaffRole('Manager'), controller.updateHrTeamRole);
// The HR directory (name/email/role, nothing sensitive). Its caller is a
// Senior HR Officer+ authorizing a delegation, looking up who's eligible
// as their delegate.
router.get('/', authenticate, requireStaffRole('Senior_HR_Officer'), controller.list);

module.exports = router;
