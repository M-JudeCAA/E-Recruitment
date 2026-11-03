const prisma = require('../config/db');
const emailPreferences = require('../services/emailPreferenceService');

// Whether a candidate's notices are also emailed (services/emailPreferenceService.js):
// from My profile while signed in, or from the link in every notice email
// without signing in (the token is the proof), including the one-click
// unsubscribe mail clients send (RFC 8058).

const NOT_FOUND = { error: 'This link is not valid. Sign in to change your email settings on your profile.' };

function choiceFrom(body) {
  return typeof body?.emailNotifications === 'boolean' ? body.emailNotifications : null;
}

async function signedInCandidate(req) {
  return prisma.candidate.findUnique({ where: { id: req.user.id }, select: emailPreferences.SELECT });
}

// GET /api/candidates/me/email-preferences
async function mine(req, res) {
  const candidate = await signedInCandidate(req);
  if (!candidate) return res.status(404).json({ error: 'Account not found' });
  res.json(emailPreferences.view(candidate));
}

// PUT /api/candidates/me/email-preferences { emailNotifications }
async function updateMine(req, res) {
  const on = choiceFrom(req.body);
  if (on === null) return res.status(400).json({ error: 'emailNotifications must be true or false' });
  const candidate = await signedInCandidate(req);
  if (!candidate) return res.status(404).json({ error: 'Account not found' });
  res.json(await emailPreferences.setEmailNotifications(candidate, on, 'profile'));
}

// GET /api/candidates/email-preferences/:token
async function byToken(req, res) {
  const candidate = await emailPreferences.candidateForToken(req.params.token);
  if (!candidate) return res.status(404).json(NOT_FOUND);
  res.json(emailPreferences.view(candidate));
}

// PUT /api/candidates/email-preferences/:token { emailNotifications }
async function updateByToken(req, res) {
  const on = choiceFrom(req.body);
  if (on === null) return res.status(400).json({ error: 'emailNotifications must be true or false' });
  const candidate = await emailPreferences.candidateForToken(req.params.token);
  if (!candidate) return res.status(404).json(NOT_FOUND);
  res.json(await emailPreferences.setEmailNotifications(candidate, on, 'link'));
}

// POST /api/candidates/email-preferences/:token/unsubscribe - a mail
// client's one-click unsubscribe (List-Unsubscribe-Post).
async function oneClickUnsubscribe(req, res) {
  const candidate = await emailPreferences.candidateForToken(req.params.token);
  if (!candidate) return res.status(404).json(NOT_FOUND);
  res.json(await emailPreferences.setEmailNotifications(candidate, false, 'one-click'));
}

module.exports = { mine, updateMine, byToken, updateByToken, oneClickUnsubscribe };
