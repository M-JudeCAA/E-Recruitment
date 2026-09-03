const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../config/db');
const staffModel = require('../models/staffModel');
const { sendMail } = require('../utils/mailer');
const { createToken } = require('../services/tokenService');

// Only these two - a PHRO+ can never create another PHRO+, Manager, or
// Director account through this endpoint (Decision: PHRO+ creates
// HRO/SHRO only).
const CREATABLE_ROLES = ['HR_Officer', 'Senior_HR_Officer'];

// A PHRO+ creates the account, but never sets or sees its password -
// the same principle already used for candidate registration (email
// confirmation) and password reset, extended here rather than inventing
// a new pattern. The account is created with an unusable placeholder
// hash and immediately sent a "set your password" link reusing the
// existing PasswordReset token machinery.
async function create(req, res) {
  const { name, email, role } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required' });
  if (!CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${CREATABLE_ROLES.join(', ')}` });
  }

  const existing = await staffModel.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'A staff account with this email already exists' });

  // Every account this endpoint creates is DHRA HR team, same as every
  // other seeded staff account (see the seed data and its own
  // department-consistency fix) - not a free-text department chosen per
  // request, and not left null against a schema column that requires a
  // value. departmentId is best-effort: if the real HR department row
  // hasn't been seeded yet, the account still gets created with the
  // legacy department string set correctly.
  const hrDepartment = await prisma.department.findFirst({ where: { name: 'HR', status: 'Approved' } });

  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const staff = await staffModel.create({
    name: name.trim(), email: email.trim(), role, department: 'HR',
    departmentId: hrDepartment ? hrDepartment.id : null,
    passwordHash: unusablePasswordHash
  });

  const token = await createToken({ type: 'PasswordReset', staffId: staff.id });
  const setPasswordUrl = `${process.env.FRONTEND_URL}/staff/reset-password?token=${token}`;
  await sendMail({
    to: staff.email,
    subject: 'Your UCAA e-Recruitment staff account',
    html: `<p>Hi ${staff.name},</p><p>An account has been created for you as ${role.replace(/_/g, ' ')}. Set your password to get started:</p><p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>`
  });

  res.status(201).json({ id: staff.id, name: staff.name, email: staff.email, role: staff.role });
}

// A PHRO+ can move an existing HRO/SHRO between those two levels only -
// this endpoint can never promote someone to PHRO+ or above. Promoting
// to a senior tier is treated as a separate, more deliberate action
// outside this feature's scope (consistent with "PHRO+ creates HRO/SHRO
// only" - a role change is a kind of re-creation).
async function updateRole(req, res) {
  const staffId = Number(req.params.id);
  const { role } = req.body;
  if (!CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${CREATABLE_ROLES.join(', ')}` });
  }

  const staff = await staffModel.findById(staffId);
  if (!staff) return res.status(404).json({ error: 'Staff account not found' });
  if (!CREATABLE_ROLES.includes(staff.role)) {
    return res.status(422).json({ error: 'This endpoint can only change the role of an existing HR Officer or Senior HR Officer' });
  }

  const updated = await staffModel.update(staffId, { role });
  res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role });
}

async function list(req, res) {
  const staff = await staffModel.findAllHRAndBelow();
  res.json(staff);
}

module.exports = { create, updateRole, list };
