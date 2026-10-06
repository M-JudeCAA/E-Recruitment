const express = require('express');
const controller = require('../controllers/staffUserController');
const { authenticate, requireStaffRole, requireSystemAdmin } = require('../middleware/auth');

const router = express.Router();

// Account administration - system administrators only, whatever HR role
// anyone holds (see requireSystemAdmin).
router.get('/accounts', authenticate, requireSystemAdmin(), controller.listAccounts);
// People assigned to the staff app in Entra with no account yet.
router.get('/entra-assignments', authenticate, requireSystemAdmin(), controller.entraAssignments);
router.post('/', authenticate, requireSystemAdmin(), controller.create);
router.patch('/:id', authenticate, requireSystemAdmin(), controller.update);
router.post('/:id/unlink', authenticate, requireSystemAdmin(), controller.unlink);
// The HR directory (name/email/role, nothing sensitive). Its caller is a
// Senior HR Officer+ authorizing a delegation, looking up who's eligible
// as their delegate.
router.get('/', authenticate, requireStaffRole('Senior_HR_Officer'), controller.list);

module.exports = router;
