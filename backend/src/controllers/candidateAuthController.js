const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const pendingRegistrationModel = require('../models/pendingRegistrationModel');
const { sendMail } = require('../utils/mailer');
const { createToken, consumeToken } = require('../services/tokenService');
const { validateEmail, validatePassword } = require('../utils/validators');
const { frontendUrl } = require('../config/frontendUrl');

// Only ever forwarded into a redirect target, never used for anything
// else - restricting it to this exact shape rules out an open-redirect
// via a crafted returnTo value riding the query string or request body.
const RETURN_TO_RE = /^\/apply\/\d+$/;
const isValidReturnTo = (value) => typeof value === 'string' && RETURN_TO_RE.test(value);

// No Candidate row (and no claim on the unique Candidate.email) is
// created until the confirmation link is actually used - the registration
// details live in PendingCandidateRegistration until then. This is what
// lets an abandoned signup be retried: a previous direct-to-Candidate
// design held the email hostage forever, since Candidate.email is unique
// regardless of emailConfirmed.
async function register(req, res) {
  const { fullName, email, password, phone, nationalId, returnTo } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email and password are required' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a digit, and a symbol' });
  }

  const existingCandidate = await candidateModel.findByEmail(email);
  if (existingCandidate) return res.status(409).json({ error: 'An account with this email already exists' });

  const existingPending = await pendingRegistrationModel.findByEmail(email);
  if (existingPending) {
    if (await pendingRegistrationModel.hasLiveToken(existingPending.id)) {
      return res.status(409).json({
        error: 'A confirmation email was already sent to this address. Check your inbox, including spam.'
      });
    }
    // Its confirmation link expired and was never used - clear it out so
    // this email can be registered again rather than staying stuck.
    await pendingRegistrationModel.remove(existingPending.id);
  }

  const domain = email.split('@')[1]?.toLowerCase();
  const candidateType = domain === (process.env.INTERNAL_EMAIL_DOMAIN || '').toLowerCase()
    ? 'Internal'
    : 'External';

  const passwordHash = await bcrypt.hash(password, 10);
  const pending = await pendingRegistrationModel.create({
    fullName, email, phone, nationalId, candidateType, passwordHash
  });

  const token = await createToken({ type: 'EmailConfirmation', pendingRegistrationId: pending.id });
  const confirmUrl = `${frontendUrl}/confirm-email?token=${token}`
    + (isValidReturnTo(returnTo) ? `&returnTo=${encodeURIComponent(returnTo)}` : '');
  await sendMail({
    to: email,
    subject: 'Confirm your e-Recruitment account',
    html: `<p>Hi ${fullName},</p><p>Please confirm your account by clicking the link below:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p>`
  });

  res.status(201).json({
    message: 'Account created. Check your email to confirm your address before logging in.',
    candidateType
  });
}

// The real Candidate row is created here, on confirmation - never
// earlier. The pending row is deleted immediately once used, since it
// has no further purpose (the "delete after the token is used" half of
// this table's lifecycle; the "delete after the token expires" half is
// handled by scripts/cleanupPendingRegistrations.js for links that are
// never used at all).
async function confirmEmail(req, res) {
  try {
    const record = await consumeToken(req.query.token, 'EmailConfirmation');
    if (!record.pendingRegistrationId) {
      throw new Error('Invalid or unknown token');
    }
    const pending = await pendingRegistrationModel.findById(record.pendingRegistrationId);
    if (!pending) {
      throw new Error('This registration is no longer available - please sign up again');
    }

    const candidate = await candidateModel.create({
      fullName: pending.fullName, email: pending.email, phone: pending.phone,
      nationalId: pending.nationalId, candidateType: pending.candidateType,
      passwordHash: pending.passwordHash, emailConfirmed: true
    });

    if (pending.candidateType === 'Internal') {
      await internalProfileModel.create({ candidateId: candidate.id });
    }

    await pendingRegistrationModel.remove(pending.id);

    res.json({ message: 'Email confirmed. You can now log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  const candidate = await candidateModel.findByEmail(email);
  if (!candidate) return res.status(401).json({ error: 'Invalid credentials' });
  if (!candidate.emailConfirmed) {
    return res.status(403).json({ error: 'Please confirm your email before logging in' });
  }
  const valid = await bcrypt.compare(password, candidate.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  // Read before overwriting - "first login" only exists in the one
  // request where lastLoginAt is about to transition from null to a real
  // timestamp. Drives the New User (full /profile/complete page) vs Old
  // User (closable dashboard modal) distinction on the frontend.
  const firstLogin = candidate.lastLoginAt === null;
  await candidateModel.update(candidate.id, { lastLoginAt: new Date() });

  const token = jwt.sign(
    { type: 'candidate', id: candidate.id, candidateType: candidate.candidateType, fullName: candidate.fullName },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, candidateType: candidate.candidateType, fullName: candidate.fullName, firstLogin });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  const candidate = await candidateModel.findByEmail(email);
  if (candidate) {
    const token = await createToken({ type: 'PasswordReset', candidateId: candidate.id });
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    await sendMail({
      to: email,
      subject: 'Reset your e-Recruitment password',
      html: `<p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
    });
  }
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a digit, and a symbol' });
  }
  try {
    const record = await consumeToken(token, 'PasswordReset');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await candidateModel.update(record.candidateId, { passwordHash });
    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { register, confirmEmail, login, forgotPassword, resetPassword };
