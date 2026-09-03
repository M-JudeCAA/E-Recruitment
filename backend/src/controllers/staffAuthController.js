const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const staffModel = require('../models/staffModel');
const { sendMail } = require('../utils/mailer');
const { createToken, consumeToken } = require('../services/tokenService');

async function login(req, res) {
  const { email, password } = req.body;
  const staff = await staffModel.findByEmail(email);
  if (!staff) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, staff.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { type: 'staff', id: staff.id, role: staff.role, department: staff.department, name: staff.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  res.json({ token, id: staff.id, role: staff.role, department: staff.department, name: staff.name });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  const staff = await staffModel.findByEmail(email);
  if (staff) {
    const token = await createToken({ type: 'PasswordReset', staffId: staff.id });
    const resetUrl = `${process.env.FRONTEND_URL}/staff/reset-password?token=${token}`;
    await sendMail({
      to: email,
      subject: 'Reset your UCAA e-Recruitment staff password',
      html: `<p>Click the link below to reset your password. This link expires in 30 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`
    });
  }
  res.json({ message: 'If a staff account exists for that email, a reset link has been sent.' });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const record = await consumeToken(token, 'PasswordReset');
    if (!record.staffId) throw new Error('Invalid token for staff password reset');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await staffModel.update(record.staffId, { passwordHash });
    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

module.exports = { login, forgotPassword, resetPassword };
