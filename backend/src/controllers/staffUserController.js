const prisma = require('../config/db');
const staffModel = require('../models/staffModel');
const audit = require('../services/auditService');
const { sendMail } = require('../utils/mailer');
const { staffFrontendUrl } = require('../config/frontendUrl');
const { internalDomains } = require('../services/entraAuthService');
const directory = require('../services/directoryService');
const { ROLE_RANK } = require('../middleware/auth');

// Staff accounts are managed by a system administrator only (requireSystemAdmin
// on every write route). Staff sign in with their UCAA Microsoft account, so
// an account is just a name, a UCAA email, a role and a department: there is
// no password to set or send. The account links itself to the person's
// Microsoft identity the first time they sign in.

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

async function departmentIdFor(name) {
  const department = await prisma.department.findFirst({ where: { name, status: 'Approved' } });
  return department ? department.id : null;
}

function signInEmail(staff) {
  const what = [
    staff.role ? staff.role.replace(/_/g, ' ') : null,
    staff.isSystemAdmin ? 'system administrator' : null
  ].filter(Boolean).join(' and ');
  return {
    to: staff.email,
    subject: 'Your UCAA e-Recruitment staff account',
    html: `<p>Hi ${staff.name},</p><p>A staff account has been created for you on the UCAA e-Recruitment system, as ${what}.</p>`
      + `<p>Sign in with your UCAA Microsoft account (${staff.email}) at <a href="${staffFrontendUrl}/staff/login">${staffFrontendUrl}/staff/login</a>. There is no separate password.</p>`
  };
}

async function create(req, res) {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = normaliseEmail(req.body.email);
  const role = parseRole(req.body.role ?? null);
  const isSystemAdmin = req.body.isSystemAdmin === true;
  const department = typeof req.body.department === 'string' && req.body.department.trim()
    ? req.body.department.trim() : 'HR';

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

  const existing = await staffModel.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists' });

  const staff = await staffModel.create({
    name, email, role, isSystemAdmin, department, departmentId: await departmentIdFor(department), entraObjectId
  });
  await audit.record({
    entityType: 'StaffUser', entityId: staff.id, action: 'Created', actor: audit.actorFrom(req),
    before: {}, after: staff, fields: AUDIT_FIELDS
  });
  await sendMail(signInEmail(staff));

  res.status(201).json({
    id: staff.id, name: staff.name, email: staff.email, role: staff.role,
    department: staff.department, isSystemAdmin: staff.isSystemAdmin, active: staff.active
  });
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
    const department = typeof req.body.department === 'string' ? req.body.department.trim() : '';
    if (!department) return res.status(400).json({ error: 'Department cannot be empty' });
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
  res.json({
    id: updated.id, name: updated.name, email: updated.email, role: updated.role,
    department: updated.department, isSystemAdmin: updated.isSystemAdmin, active: updated.active
  });
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

module.exports = { create, update, unlink, list, listAccounts, entraAssignments };
