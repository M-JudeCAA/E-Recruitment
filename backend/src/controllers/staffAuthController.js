const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const staffModel = require('../models/staffModel');
const { verifyIdToken, EntraAuthError } = require('../services/entraAuthService');
const audit = require('../services/auditService');

function sessionFor(staff) {
  const token = jwt.sign(
    {
      type: 'staff', id: staff.id, role: staff.role, isSystemAdmin: staff.isSystemAdmin,
      department: staff.department, departmentId: staff.departmentId, name: staff.name
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  return {
    token, role: staff.role, isSystemAdmin: staff.isSystemAdmin, department: staff.department,
    departmentId: staff.departmentId, name: staff.name, email: staff.email
  };
}

// Staff sign in with their UCAA Microsoft account. Anyone in the tenant can
// get an ID token (Entra has no notion of "HR staff" here), so the token
// only says who they are: they get in only if a system administrator has
// created an active StaffUser for them, and only with the role on it.
// The first sign-in links the account by email; after that the oid alone
// matches, so the account follows the person, not the mailbox.
async function entraLogin(req, res) {
  let identity;
  try {
    identity = await verifyIdToken(req.body.idToken, 'staff');
  } catch (err) {
    if (err instanceof EntraAuthError) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  let staff = await staffModel.findByEntraObjectId(identity.oid);
  if (!staff) {
    const byEmail = await staffModel.findByEmail(identity.email);
    if (byEmail && byEmail.entraObjectId && byEmail.entraObjectId !== identity.oid) {
      // The address now belongs to a different Microsoft identity than the
      // one this account was linked to - a reused mailbox, not the same person.
      return res.status(403).json({ error: 'This staff account is linked to a different Microsoft account. Contact the system administrator.' });
    }
    staff = byEmail;
  }
  if (!staff) {
    return res.status(403).json({
      error: `There is no staff account for ${identity.email}. If you need one, ask the system administrator. To apply for a job, use the candidate site instead.`
    });
  }
  if (!staff.active) {
    return res.status(403).json({ error: 'Your staff account has been deactivated. Contact the system administrator.' });
  }
  if (!staff.role && !staff.isSystemAdmin) {
    return res.status(403).json({ error: 'Your staff account has no role yet. Contact the system administrator.' });
  }

  staff = await staffModel.update(staff.id, { entraObjectId: identity.oid, lastLoginAt: new Date() });
  res.json(sessionFor(staff));
}

// Local development only (no Entra tenant to hand): any staff account that
// has a password - which only the dev seed (prisma/seed.js) gives them.
// Never honoured in production, whatever the flag says.
function devPasswordLogin() {
  return process.env.DEV_PASSWORD_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}

// Password sign-in, off by default. Two uses only:
// - break-glass: a system administrator's password, for when Microsoft
//   sign-in is unavailable, while BREAK_GLASS_LOGIN=true on the server. The
//   password is set on the server with scripts/createSystemAdmin.js.
// - local development, while DEV_PASSWORD_LOGIN=true (see above).
async function login(req, res) {
  const breakGlass = process.env.BREAK_GLASS_LOGIN === 'true';
  if (!breakGlass && !devPasswordLogin()) {
    return res.status(404).json({ error: 'Password sign-in is turned off. Sign in with your UCAA Microsoft account.' });
  }
  const { email, password } = req.body;
  const staff = email ? await staffModel.findByEmail(email) : null;
  const allowed = staff && staff.active && staff.passwordHash && password
    && (devPasswordLogin() || staff.isSystemAdmin);
  if (!allowed) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, staff.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const mode = devPasswordLogin() ? 'development' : 'break-glass';
  console.warn(`Password sign-in (${mode}) by staff #${staff.id} (${staff.email})`);
  const updated = await staffModel.update(staff.id, { lastLoginAt: new Date() });
  await audit.record({ entityType: 'StaffUser', entityId: staff.id, action: 'PasswordSignIn', actor: { performedById: staff.id }, details: { mode } });
  res.json(sessionFor(updated));
}

module.exports = { entraLogin, login };
