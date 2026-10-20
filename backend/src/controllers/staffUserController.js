const prisma = require('../config/db');
const staffModel = require('../models/staffModel');
const audit = require('../services/auditService');
const { sendMail } = require('../utils/mailer');
const { staffFrontendUrl } = require('../config/frontendUrl');
const { internalDomains } = require('../services/entraAuthService');
const directory = require('../services/directoryService');
const staffGroup = require('../services/staffGroupService');
const { ROLE_RANK } = require('../middleware/auth');
const { STAFF_DEPARTMENTS, HR_DEPARTMENT, parseStaffDepartment, isHrDepartment } = require('../utils/staffDepartments');

// Staff accounts are managed by a system administrator (requireSystemAdmin on
// the account routes): creating them, their role, department (HR or ICT,
// utils/staffDepartments.js), administrator rights and active state. Staff
// sign in with their UCAA Microsoft account, so an account is just a name, a
// UCAA email, a role and a department: there is no password to set or send.
// The account links itself to the person's Microsoft identity the first time
// they sign in. Where the staff app's Entra group is managed from here
// (staffGroupService), an account is made only for someone picked from the
// directory, and creating / deactivating / reactivating it adds the person
// to or removes them from that group.
//
// An HR Manager (their own role Manager or Director - not a delegation - in
// the HR department) also sees the HR department's accounts and changes
// their HR roles, nothing else (hrTeam / updateHrTeamRole): only for staff
// ranked below them, only to a role below their own, never their own
// account or a system administrator's. They can't create accounts.

const ROLES = Object.keys(ROLE_RANK);
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUDIT_FIELDS = ['name', 'email', 'role', 'department', 'isSystemAdmin', 'active'];

function normaliseEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// role: one of the five HR roles, or null/'' for none (an accounts-only
// system administrator). Returns undefined when it is neither.
function parseRole(role) {
  if (role === null || role === '') return null;
  return ROLES.includes(role) ? role : undefined;
}

// The staff account's department text may be the department's full name or
// its short code.
async function departmentIdFor(name) {
  const department = await prisma.department.findFirst({ where: { OR: [{ name }, { code: name }], status: 'Approved' } });
  return department ? department.id : null;
}

// What the Staff accounts page shows about the staff app's group.
const groupView = (result) => ({ configured: result.configured, state: result.state, error: result.error });

const accountView = (staff) => ({
  id: staff.id, name: staff.name, email: staff.email, role: staff.role,
  department: staff.department, isSystemAdmin: staff.isSystemAdmin, active: staff.active
});

async function create(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = normaliseEmail(req.body.email);
  const role = parseRole(req.body.role ?? null);
  const isSystemAdmin = req.body.isSystemAdmin === true;
  const department = req.body.department == null || req.body.department === '' ? HR_DEPARTMENT : parseStaffDepartment(req.body.department);
  if (!department) return res.status(400).json({ error: `Department must be one of: ${STAFF_DEPARTMENTS.join(', ')}` });

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!internalDomains().includes(email.split('@')[1])) {
    return res.status(400).json({ error: 'Staff accounts must use a UCAA email address - it is the Microsoft account they sign in with' });
  }
  if (role === undefined) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}, or none` });
  if (!role && !isSystemAdmin) {
    return res.status(400).json({ error: 'Give the account an HR role, make it a system administrator, or both' });
  }

  // Picked from the directory (or the "Waiting for a role" list): the
  // person's Microsoft object id, so the account is linked to them from
  // the start rather than at first sign-in by email.
  let entraObjectId = null;
  if (req.body.entraObjectId != null && req.body.entraObjectId !== '') {
    entraObjectId = String(req.body.entraObjectId).toLowerCase();
    if (!GUID_RE.test(entraObjectId)) return res.status(400).json({ error: 'entraObjectId must be a Microsoft object id' });
    if (await staffModel.findByEntraObjectId(entraObjectId)) {
      return res.status(409).json({ error: 'This Microsoft account already has a staff account' });
    }
  }

  // The group takes a Microsoft account, so the person must come from the
  // directory, not be typed in.
  if (!entraObjectId && staffGroup.isConfigured()) {
    return res.status(400).json({
      error: "Pick the person from the UCAA directory - it is their Microsoft account that is added to the staff app's group in Entra.",
      code: 'PICK_FROM_DIRECTORY'
    });
  }

  const existing = await staffModel.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists' });

  const staff = await staffModel.create({
    name, email, role, isSystemAdmin, department, departmentId: await departmentIdFor(department), entraObjectId
  });
  await audit.record({
    entityType: 'StaffUser', entityId: staff.id, action: 'Created', actor: audit.actorFrom(req),
    before: {}, after: staff, fields: AUDIT_FIELDS
  });
  // Into the staff app's group, and emailed once they can sign in. Without
  // the group managed here, emailed straight away as before.
  let group = { configured: false, state: null, error: null };
  if (staffGroup.isConfigured()) group = await staffGroup.sync(staff, { req, welcome: true });
  else await sendMail(staffGroup.welcomeEmail(staff));

  res.status(201).json({ ...accountView(staff), entraGroup: groupView(group) });
}

// Change an account's role, department, administrator flag or active state.
// Nobody changes their own account - otherwise an administrator could give
// themselves any HR role - and the last active administrator can't be
// removed or deactivated.
async function update(req, res) {
  const staffId = Number(req.params.id);
  if (staffId === req.user.id) {
    return res.status(403).json({ error: 'You cannot change your own account. Ask another system administrator.' });
  }
  const staff = await staffModel.findById(staffId);
  if (!staff) return res.status(404).json({ error: 'Staff account not found' });

  const data = {};
  if ('role' in req.body) {
    const role = parseRole(req.body.role);
    if (role === undefined) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}, or none` });
    data.role = role;
  }
  if ('isSystemAdmin' in req.body) data.isSystemAdmin = req.body.isSystemAdmin === true;
  if ('active' in req.body) data.active = req.body.active === true;
  if ('department' in req.body) {
    const department = parseStaffDepartment(req.body.department);
    if (!department) return res.status(400).json({ error: `Department must be one of: ${STAFF_DEPARTMENTS.join(', ')}` });
    data.department = department;
    data.departmentId = await departmentIdFor(department);
  }
  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to change' });

  const next = { ...staff, ...data };
  if (!next.role && !next.isSystemAdmin) {
    return res.status(400).json({ error: 'An account needs an HR role, system administrator rights, or both' });
  }
  const losesAdmin = staff.isSystemAdmin && staff.active && (!next.isSystemAdmin || !next.active);
  if (losesAdmin && (await staffModel.countActiveAdmins()) <= 1) {
    return res.status(409).json({ error: 'This is the last active system administrator - add another one first' });
  }

  const updated = await staffModel.update(staffId, data);
  await audit.record({
    entityType: 'StaffUser', entityId: staffId, action: 'Updated', actor: audit.actorFrom(req),
    before: staff, after: updated, fields: AUDIT_FIELDS, comment: req.body.comment
  });
  // Deactivated: out of the staff app's group; reactivated: back in.
  let group;
  if (updated.active !== staff.active && staffGroup.isConfigured()) {
    group = groupView(await staffGroup.sync(updated, { req }));
  }
  res.json({ ...accountView(updated), ...(group ? { entraGroup: group } : {}) });
}

// Forget the Microsoft identity an account was linked to, so it links again
// on the next sign-in - for when someone's Microsoft account was deleted and
// recreated (a new object id for the same person and address).
async function unlink(req, res) {
  const staffId = Number(req.params.id);
  if (staffId === req.user.id) {
    return res.status(403).json({ error: 'You cannot change your own account. Ask another system administrator.' });
  }
  const staff = await staffModel.findById(staffId);
  if (!staff) return res.status(404).json({ error: 'Staff account not found' });
  if (!staff.entraObjectId) return res.status(409).json({ error: 'This account is not linked to a Microsoft account yet' });

  await staffModel.update(staffId, { entraObjectId: null });
  await audit.record({
    entityType: 'StaffUser', entityId: staffId, action: 'MicrosoftAccountUnlinked', actor: audit.actorFrom(req),
    comment: req.body?.comment
  });
  res.json({ id: staffId, linked: false });
}

// POST /api/staff-users/:id/entra-group - try again to put the account where
// it belongs in the staff app's group (in while active, out once
// deactivated), after a failure.
async function retryEntraGroup(req, res) {
  if (!staffGroup.isConfigured()) {
    return res.status(501).json({ error: "The staff app's Entra group is not managed from here (ENTRA_STAFF_GROUP_ID).", code: 'STAFF_GROUP_NOT_CONFIGURED' });
  }
  const staff = await staffModel.findById(Number(req.params.id));
  if (!staff) return res.status(404).json({ error: 'Staff account not found' });
  res.json({ ...accountView(staff), entraGroup: groupView(await staffGroup.sync(staff, { req })) });
}

// GET /api/staff-users/entra-group - whether the staff app's group is
// managed from here (the Create form then insists on a directory pick).
function entraGroupSettings(req, res) {
  res.json({ configured: staffGroup.isConfigured() });
}

// --- The HR Manager's team ----------------------------------------------

// The signed-in staff member, when they may manage the HR team's roles: their
// own role (re-read, not a delegation) Manager or above, in the HR
// department. Otherwise null.
async function hrManager(req) {
  const me = await staffModel.findById(req.user.id);
  if (!me || !me.active || (ROLE_RANK[me.role] || 0) < ROLE_RANK.Manager || !isHrDepartment(me.department)) return null;
  return me;
}

const NOT_HR_MANAGER = { error: "Only an HR Manager or Director in the HR department can manage the HR team's roles.", code: 'NOT_HR_MANAGER' };

// The roles a manager may give: those below their own.
const assignableRoles = (me) => ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK[me.role]);

// Why a manager can't change this account's role, or null when they can.
function lockedReason(me, account) {
  if (account.id === me.id) return 'This is your own account.';
  if (account.isSystemAdmin) return "A system administrator's account - only a system administrator can change it.";
  if (!account.role || ROLE_RANK[account.role] >= ROLE_RANK[me.role]) return 'Ranked the same as you or above.';
  return null;
}

const teamMember = (me, a) => ({
  id: a.id, name: a.name, email: a.email, role: a.role, department: a.department, isSystemAdmin: a.isSystemAdmin,
  active: a.active, lastLoginAt: a.lastLoginAt, lockedReason: lockedReason(me, a)
});

// GET /api/staff-users/hr-team - the HR department's accounts, and the roles
// the manager may give.
async function hrTeam(req, res) {
  const me = await hrManager(req);
  if (!me) return res.status(403).json(NOT_HR_MANAGER);
  const accounts = await staffModel.findByDepartment(HR_DEPARTMENT);
  res.json({ assignableRoles: assignableRoles(me), accounts: accounts.map((a) => teamMember(me, a)) });
}

// PATCH /api/staff-users/hr-team/:id/role { role, comment } - an HR Manager
// changes one HR staff member's role. Takes effect on their next request
// (requireStaffRole re-reads the account). Audited.
async function updateHrTeamRole(req, res) {
  const me = await hrManager(req);
  if (!me) return res.status(403).json(NOT_HR_MANAGER);
  const staffId = Number(req.params.id);
  const account = Number.isInteger(staffId) ? await staffModel.findById(staffId) : null;
  // Someone outside the HR department isn't theirs to see.
  if (!account || !isHrDepartment(account.department)) return res.status(404).json({ error: 'There is no such account in the HR department.' });
  const locked = lockedReason(me, account);
  if (locked) return res.status(403).json({ error: `You can't change ${account.name}'s role: ${locked}`, code: 'ROLE_CHANGE_NOT_ALLOWED' });

  const role = parseRole(req.body.role);
  if (!role) return res.status(400).json({ error: `Choose one of: ${assignableRoles(me).join(', ')}` });
  if (!assignableRoles(me).includes(role)) {
    return res.status(403).json({ error: 'You can only give a role below your own.', code: 'ROLE_CHANGE_NOT_ALLOWED' });
  }
  if (role === account.role) return res.status(400).json({ error: `${account.name} is already ${role.replace(/_/g, ' ')}` });

  const updated = await staffModel.update(staffId, { role });
  await audit.record({
    entityType: 'StaffUser', entityId: staffId, action: 'HR role changed by HR Manager', actor: audit.actorFrom(req),
    before: account, after: updated, fields: ['role'], comment: typeof req.body.comment === 'string' ? req.body.comment.trim() || undefined : undefined
  });
  res.json(teamMember(me, updated));
}

// The HR directory (name/email/role), e.g. for choosing a delegate.
async function list(req, res) {
  res.json(await staffModel.findAllHRAndBelow());
}

// Every account, for the system administrator's screen.
async function listAccounts(req, res) {
  res.json(await staffModel.findAllForAdmin());
}

// GET /api/staff-users/entra-assignments - people an Entra administrator
// has assigned to the staff app (directly or through a group) who have no
// staff account yet, newest assignment first: the system administrator
// gives each a role and the account is made (create, with entraObjectId).
// Entra says who may use the app; the role is still decided here.
async function entraAssignments(req, res) {
  if (!directory.isConfigured()) {
    return res.status(501).json({
      error: 'The Microsoft directory is not connected, so people assigned to the staff app in Entra can\'t be listed here.',
      code: 'DIRECTORY_NOT_CONFIGURED'
    });
  }
  let assigned;
  try {
    assigned = await directory.staffAppAssignments();
  } catch (err) {
    console.error('Reading the staff app assignments failed:', err.message);
    return res.status(502).json({
      error: err.status === 403
        ? 'Microsoft Entra refused to list the staff app\'s users - an Entra administrator needs to grant the Application.Read.All and GroupMember.Read.All permissions.'
        : 'The staff app\'s users could not be read from Microsoft Entra just now.',
      code: 'DIRECTORY_UNAVAILABLE'
    });
  }
  const accounts = await prisma.staffUser.findMany({ select: { email: true, entraObjectId: true } });
  const emails = new Set(accounts.map((a) => a.email.toLowerCase()));
  const oids = new Set(accounts.map((a) => a.entraObjectId).filter(Boolean));
  res.json(assigned.filter((p) => !oids.has(p.entraObjectId) && !emails.has(p.email)));
}

module.exports = { create, update, unlink, list, listAccounts, entraAssignments, retryEntraGroup, entraGroupSettings, hrTeam, updateHrTeamRole };
