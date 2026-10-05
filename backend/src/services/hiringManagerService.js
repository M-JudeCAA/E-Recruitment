const prisma = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { escapeHtml } = require('../utils/interviewFormat');
const { internalDomains } = require('./entraAuthService');

// The hiring manager: the UCAA employee the vacancy is being filled for,
// picked from the directory when the vacancy is created (or later). They
// have no access to the system - they are kept informed by email at each
// milestone of their recruitment, and nothing else. notify() never throws:
// a failed email must not fail the action that triggered it.

const MAX = 191;

/**
 * Reads { name, email, entraObjectId?, jobTitle? } from a request body.
 * null/'' clears it. Returns { data } (Vacancy columns) or { error }.
 */
function parseHiringManager(input) {
  if (input === null || input === '') {
    return { data: { hiringManagerName: null, hiringManagerEmail: null, hiringManagerEntraId: null, hiringManagerJobTitle: null } };
  }
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'hiringManager must be an object' };
  const name = String(input.name || '').trim().slice(0, MAX);
  const email = String(input.email || '').trim().toLowerCase().slice(0, MAX);
  if (name.length < 2) return { error: 'Enter the hiring manager\'s name' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter the hiring manager\'s email' };
  if (!internalDomains().includes(email.split('@')[1])) {
    return { error: 'The hiring manager must be a UCAA employee - use their UCAA email address' };
  }
  const entraId = input.entraObjectId ? String(input.entraObjectId).trim() : '';
  return {
    data: {
      hiringManagerName: name,
      hiringManagerEmail: email,
      hiringManagerEntraId: /^[0-9a-f-]{36}$/i.test(entraId) ? entraId.toLowerCase() : null,
      hiringManagerJobTitle: input.jobTitle ? String(input.jobTitle).trim().slice(0, MAX) || null : null
    }
  };
}

const list = (names) => `<ul>${names.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Africa/Kampala' });

// Subject and body (HTML, escaped) per milestone.
const MESSAGES = {
  published: (v) => ({
    subject: 'advertised',
    body: `<p>The vacancy has been approved and is now advertised.${v.deadline ? ` Applications close on <strong>${day(v.deadline)}</strong>.` : ''}</p>`
  }),
  applicationsClosed: (v, d) => ({
    subject: 'applications closed',
    body: `<p>Applications have closed: <strong>${d.count}</strong> application${d.count === 1 ? ' was' : 's were'} received. HR will now shortlist candidates for interview.</p>`
  }),
  shortlistApproved: (v, d) => ({
    subject: 'interview shortlist approved',
    body: `<p>EXCO has approved the interview shortlist: <strong>${d.names.length}</strong> candidate${d.names.length === 1 ? '' : 's'}.</p>${list(d.names)}<p>HR will schedule the interviews next.</p>`
  }),
  interviewsScheduled: (v, d) => ({
    subject: 'interviews scheduled',
    body: `<p>${d.count} interview${d.count === 1 ? ' has' : 's have'} been scheduled${d.from ? `, from <strong>${day(d.from)}</strong>${d.to && day(d.to) !== day(d.from) ? ` to <strong>${day(d.to)}</strong>` : ''}` : ''}.</p>`
  }),
  meritListApproved: (v, d) => ({
    subject: 'merit list approved',
    body: `<p>The merit list has been approved. Recommended for appointment:</p>${list(d.primary)}${d.reserve.length ? `<p>In reserve:</p>${list(d.reserve)}` : ''}<p>HR will now prepare the offer${d.primary.length === 1 ? '' : 's'}.</p>`
  }),
  offerAccepted: (v, d) => ({
    subject: d.filled ? 'filled' : 'offer accepted',
    body: `<p><strong>${escapeHtml(d.candidateName)}</strong> has accepted the offer${d.startDate ? `, starting on ${day(d.startDate)}` : ''}.</p>${d.filled ? '<p>All positions on this vacancy are now filled.</p>' : ''}`
  }),
  offerNotTaken: (v, d) => ({
    subject: 'offer not taken up',
    body: `<p>The offer to <strong>${escapeHtml(d.candidateName)}</strong> was ${escapeHtml(d.outcome)}.${d.promotedName ? ` <strong>${escapeHtml(d.promotedName)}</strong>, next on the merit list, moves up.` : ''}</p>`
  }),
  closed: (v, d) => ({
    subject: 'closed',
    body: `<p>The vacancy has been closed${d.reason ? `: ${escapeHtml(d.reason)}` : '.'}</p>`
  })
};

async function notify(vacancyOrId, event, details = {}) {
  try {
    const vacancy = typeof vacancyOrId === 'object' && vacancyOrId?.hiringManagerEmail !== undefined
      ? vacancyOrId
      : await prisma.vacancy.findUnique({ where: { id: Number(vacancyOrId?.id ?? vacancyOrId) } });
    if (!vacancy?.hiringManagerEmail || !MESSAGES[event]) return false;
    const { subject, body } = MESSAGES[event](vacancy, details);
    await sendMail({
      to: vacancy.hiringManagerEmail,
      subject: `Recruitment update: ${vacancy.title} (${vacancy.jobRef}) - ${subject}`,
      html: `<p>Dear ${escapeHtml(vacancy.hiringManagerName || 'colleague')},</p>`
        + `<p>An update on the recruitment for <strong>${escapeHtml(vacancy.title)}</strong> (${escapeHtml(vacancy.jobRef)}), for which you are the hiring manager.</p>`
        + body
        + '<p>You are receiving this because HR named you as the hiring manager. There is nothing you need to do in the system - contact HR with any questions.</p>'
        + '<p>UCAA Human Resources</p>'
    });
    return true;
  } catch (err) {
    console.error(`Hiring manager update (${event}) failed:`, err);
    return false;
  }
}

module.exports = { parseHiringManager, notify, MESSAGES };
