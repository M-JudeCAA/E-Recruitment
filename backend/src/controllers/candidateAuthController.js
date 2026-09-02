const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const pendingCandidateRegistrationModel = require('../models/pendingCandidateRegistrationModel');
const { sendMail } = require('../utils/mailer');
const { createToken, consumeToken } = require('../services/tokenService');

const PENDING_REGISTRATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESEND_COOLDOWN_MS = 1000 * 60; // 1 minute
const MAX_CODE_ATTEMPTS = 5;

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function generateVerificationCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

// Internal (@caa.co.ug) candidate mail can't be relied on to deliver a link - it
// gets stripped/blocked by that domain's corporate mail filtering. A plain-text
// code has no URL for the filter to flag, so internal candidates verify with a
// code instead of clicking a link; external candidates keep the link flow.
async function sendConfirmationEmail(pending) {
  if (pending.candidateType === 'Internal') {
    await sendMail({
      to: pending.email,
      subject: 'Your e-Recruitment verification code',
      html: `<p>Hi ${pending.fullName},</p><p>Your verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${pending.verificationCode}</p><p>Enter this code on the verification page to activate your account. This code expires in 24 hours.</p>`
    });
  } else {
    const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email?token=${pending.token}`;
    await sendMail({
      to: pending.email,
      subject: 'Confirm your e-Recruitment account',
      html: `<p>Hi ${pending.fullName},</p><p>Please confirm your account by clicking the link below:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p>`
    });
  }
}

async function activateCandidate(pending) {
  const existing = await candidateModel.findByEmail(pending.email);
  if (existing) {
    await pendingCandidateRegistrationModel.deleteById(pending.id);
    return null;
  }

  const candidate = await candidateModel.create({
    fullName: pending.fullName,
    email: pending.email,
    phone: pending.phone,
    nationalId: pending.nationalId,
    candidateType: pending.candidateType,
    passwordHash: pending.passwordHash,
    emailConfirmed: true
  });

  if (pending.candidateType === 'Internal') {
    await internalProfileModel.create({ candidateId: candidate.id });
  }

  await pendingCandidateRegistrationModel.deleteById(pending.id);
  return candidate;
}

async function register(req, res) {
  const { fullName, password, phone, nationalId } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email and password are required' });
  }

  const existing = await candidateModel.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const domain = email.split('@')[1];
  const candidateType = domain === (process.env.INTERNAL_EMAIL_DOMAIN || '').toLowerCase()
    ? 'Internal'
    : 'External';

  const passwordHash = await bcrypt.hash(password, 10);

  // Re-registering before confirming (e.g. after a typo) replaces the earlier pending
  // registration and its token/code rather than creating a second one for the same email.
  const pending = await pendingCandidateRegistrationModel.upsertByEmail(email, {
    fullName,
    phone: phone || null,
    nationalId: nationalId || null,
    candidateType,
    passwordHash,
    token: candidateType === 'Internal' ? null : crypto.randomBytes(32).toString('hex'),
    verificationCode: candidateType === 'Internal' ? generateVerificationCode() : null,
    codeAttempts: 0,
    expiresAt: new Date(Date.now() + PENDING_REGISTRATION_TTL_MS),
    lastSentAt: new Date()
  });

  await sendConfirmationEmail(pending);

  res.status(201).json({
    message: candidateType === 'Internal'
      ? 'Registration received. Check your email for a verification code to activate your account.'
      : 'Registration received. Check your email to verify your address and activate your account.',
    candidateType
  });
}

async function confirmEmail(req, res) {
  const pending = await pendingCandidateRegistrationModel.findByToken(req.query.token);
  if (!pending) {
    return res.status(400).json({ error: 'Invalid or expired confirmation link' });
  }
  if (pending.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This confirmation link has expired. Request a new one and try again.' });
  }

  const candidate = await activateCandidate(pending);
  if (!candidate) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  res.json({ message: 'Email confirmed. You can now log in.' });
}

async function confirmCode(req, res) {
  const email = normalizeEmail(req.body.email);
  const code = (req.body.code || '').trim();
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const pending = await pendingCandidateRegistrationModel.findByEmail(email);
  if (!pending || !pending.verificationCode) {
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }
  if (pending.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This verification code has expired. Request a new one and try again.' });
  }
  if (pending.codeAttempts >= MAX_CODE_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Request a new verification code.' });
  }

  if (code !== pending.verificationCode) {
    await pendingCandidateRegistrationModel.updateToken(pending.id, { codeAttempts: pending.codeAttempts + 1 });
    return res.status(400).json({ error: 'Invalid or expired verification code' });
  }

  const candidate = await activateCandidate(pending);
  if (!candidate) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  res.json({ message: 'Email confirmed. You can now log in.' });
}

async function resendVerification(req, res) {
  const email = normalizeEmail(req.body.email);
  const generic = { message: "If a pending registration exists for that email, we've sent a new verification link or code." };
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const pending = await pendingCandidateRegistrationModel.findByEmail(email);
  if (!pending) return res.json(generic);

  if (Date.now() - pending.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    return res.json(generic);
  }

  const updated = await pendingCandidateRegistrationModel.updateToken(pending.id, {
    token: pending.candidateType === 'Internal' ? null : crypto.randomBytes(32).toString('hex'),
    verificationCode: pending.candidateType === 'Internal' ? generateVerificationCode() : null,
    codeAttempts: 0,
    expiresAt: new Date(Date.now() + PENDING_REGISTRATION_TTL_MS),
    lastSentAt: new Date()
  });

  await sendConfirmationEmail(updated);

  res.json(generic);
}

async function login(req, res) {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  const candidate = await candidateModel.findByEmail(email);
  if (!candidate) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, candidate.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { type: 'candidate', id: candidate.id, candidateType: candidate.candidateType },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, candidateType: candidate.candidateType });
}

async function forgotPassword(req, res) {
  const email = normalizeEmail(req.body.email);
  const candidate = await candidateModel.findByEmail(email);
  if (candidate) {
    const token = await createToken({ type: 'PasswordReset', candidateId: candidate.id });
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
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
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
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

module.exports = { register, confirmEmail, confirmCode, resendVerification, login, forgotPassword, resetPassword };
