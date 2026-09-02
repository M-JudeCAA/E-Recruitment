const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const { sendMail } = require('../utils/mailer');
const { createToken, consumeToken } = require('../services/tokenService');

async function register(req, res) {
  const { fullName, email, password, phone, nationalId } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email and password are required' });
  }

  const existing = await candidateModel.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const domain = email.split('@')[1]?.toLowerCase();
  const candidateType = domain === (process.env.INTERNAL_EMAIL_DOMAIN || '').toLowerCase()
    ? 'Internal'
    : 'External';

  const passwordHash = await bcrypt.hash(password, 10);
  const candidate = await candidateModel.create({
    fullName, email, phone, nationalId, candidateType, passwordHash, emailConfirmed: false
  });

  if (candidateType === 'Internal') {
    await internalProfileModel.create({ candidateId: candidate.id });
  }

  const token = await createToken({ type: 'EmailConfirmation', candidateId: candidate.id });
  const confirmUrl = `${process.env.FRONTEND_URL}/confirm-email?token=${token}`;
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

async function confirmEmail(req, res) {
  try {
    const record = await consumeToken(req.query.token, 'EmailConfirmation');
    await candidateModel.update(record.candidateId, { emailConfirmed: true });
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

  const token = jwt.sign(
    { type: 'candidate', id: candidate.id, candidateType: candidate.candidateType },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, candidateType: candidate.candidateType });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
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

module.exports = { register, confirmEmail, login, forgotPassword, resetPassword };
