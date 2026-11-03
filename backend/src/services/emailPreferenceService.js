const crypto = require('crypto');
const prisma = require('../config/db');
const audit = require('./auditService');
const { frontendUrl, internalFrontendUrl } = require('../config/frontendUrl');
const { escapeHtml } = require('../utils/interviewFormat');

// A candidate's choice to stop notice emails (Candidate.emailNotifications),
// Internal and External alike. Off, notices still arrive in-app
// (candidateNotificationService) and HR's bulk emails skip them; account
// emails - confirming the address, a password reset, erasure done - always
// go, since they are how someone gets back into their account.
//
// Every notice email carries a link to change it without signing in: a token
// signed with JWT_SECRET over the candidate id (no expiry - an unsubscribe
// link must keep working), opening the email preferences page on the
// candidate's own site (Internal Careers or the public site), plus the
// List-Unsubscribe headers so mail clients can offer one-click unsubscribe
// (RFC 8058, a POST to the API).

const PURPOSE = 'email-preferences';

function signature(candidateId) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${PURPOSE}:${candidateId}`).digest('base64url');
}

/** The candidate's unsubscribe token: "<id>-<signature>" (masked in the request logs, requestContext.js). */
function tokenFor(candidateId) {
  return `${candidateId}-${signature(candidateId)}`;
}

/** The candidate id a token was made for, or null if it is not genuine. */
function candidateIdFrom(token) {
  const text = String(token || '');
  const cut = text.indexOf('-');
  const id = text.slice(0, cut);
  const sig = cut > 0 ? text.slice(cut + 1) : '';
  const candidateId = Number(id);
  if (!process.env.JWT_SECRET || !Number.isInteger(candidateId) || candidateId <= 0 || !sig) return null;
  const expected = Buffer.from(signature(candidateId));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? candidateId : null;
}

const siteOf = (candidate) => (candidate.candidateType === 'Internal' ? internalFrontendUrl : frontendUrl).replace(/\/$/, '');

/** Where the candidate changes it: { page, oneClick } (absolute URLs). */
function linksFor(candidate) {
  const token = tokenFor(candidate.id);
  const site = siteOf(candidate);
  return {
    page: `${site}/email-preferences/${token}`,
    // The API is served under the site's own origin (/api, proxied).
    oneClick: `${site}/api/candidates/email-preferences/${token}/unsubscribe`
  };
}

/** The footer and headers for a notice email to this candidate. */
// Without a signing secret (never in a running server) the email goes
// without them rather than not at all.
function emailExtras(candidate) {
  if (!process.env.JWT_SECRET) return { footer: '', headers: undefined };
  const { page, oneClick } = linksFor(candidate);
  return {
    footer: `<p style="color:#666;font-size:12px">You get these emails about your UCAA applications. `
      + `<a href="${escapeHtml(page)}" style="color:#1C719D">Stop these emails</a> - you will still see every notice when you sign in.</p>`,
    headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  };
}

// "j***@caa.co.ug" - enough for someone to recognise their address.
function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  return domain ? `${name.slice(0, 1)}***@${domain}` : '';
}

const SELECT = { id: true, email: true, candidateType: true, emailNotifications: true, emailNotificationsChangedAt: true, purgedAt: true };

/** The candidate a genuine token names (never an erased one), or null. */
async function candidateForToken(token) {
  const candidateId = candidateIdFrom(token);
  if (!candidateId) return null;
  const candidate = await prisma.candidate.findUnique({ where: { id: candidateId }, select: SELECT });
  return candidate && !candidate.purgedAt ? candidate : null;
}

const view = (candidate) => ({
  emailNotifications: candidate.emailNotifications,
  changedAt: candidate.emailNotificationsChangedAt,
  email: maskEmail(candidate.email)
});

/**
 * Turn notice emails on or off. via: 'profile' (signed in) or 'link' (the
 * emailed link). Audited on the candidate as their own action.
 */
async function setEmailNotifications(candidate, on, via) {
  if (candidate.emailNotifications === on) return view(candidate);
  const after = await prisma.candidate.update({
    where: { id: candidate.id },
    data: { emailNotifications: on, emailNotificationsChangedAt: new Date() },
    select: SELECT
  });
  await audit.record({
    entityType: 'Candidate', entityId: candidate.id, actor: { candidateId: candidate.id },
    action: on ? 'Notice emails turned on' : 'Notice emails turned off',
    before: candidate, after, fields: ['emailNotifications'], details: { via }
  });
  return view(after);
}

module.exports = { tokenFor, candidateIdFrom, linksFor, emailExtras, maskEmail, candidateForToken, setEmailNotifications, view, SELECT };
