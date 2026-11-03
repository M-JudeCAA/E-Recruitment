const candidateNotificationModel = require('../models/candidateNotificationModel');
const candidateModel = require('../models/candidateModel');
const { sendMail } = require('../utils/mailer');
const { renderEmail } = require('../utils/emailLayout');
const { frontendUrl, internalFrontendUrl } = require('../config/frontendUrl');
const emailPreferences = require('./emailPreferenceService');

// Same dual-channel pairing principle as notificationService.notify() for
// staff: always in-app, and emailed too unless the candidate has turned
// notice emails off (Candidate.emailNotifications, emailPreferenceService).
// Every email carries the link to turn them off.
//
// The email is laid out by utils/emailLayout.js: the heading and subject for
// the type (EMAILS), "Dear <name>", the message, an optional quote, and a
// button to where it is about on the candidate's own site (the same place as
// the bell's link, frontend utils/candidateNotificationLinks.js).
//
// options.calendar(candidate) may return an icalEvent ({ method, content,
// filename }) for the email - an interview invitation the candidate's
// calendar picks up, in the same email as the message. options.subject
// overrides the subject for the type; options.quote ({ label, text }) is
// shown set apart - HR's comment on their employment details - and added to
// the in-app notice too.

const EMAILS = {
  ProfileCompleted: { title: 'Your profile is complete', page: 'profile' },
  ApplicationSubmitted: { title: 'We have received your application' },
  ApplicationShortlisted: { title: 'You have been shortlisted' },
  ApplicationRejected: { title: 'An update on your application' },
  ApplicationReinstated: { title: 'Your application is back under consideration' },
  RecruitmentDiscontinued: { title: 'An update on a vacancy you applied for' },
  InterviewScheduled: { title: 'You are invited to an interview' },
  InterviewRescheduled: { title: 'Your interview has been moved' },
  InterviewCancelled: { title: 'Your interview has been cancelled' },
  InterviewReminder: { title: 'Reminder: your interview is coming up' },
  OfferReceived: { title: 'You have a job offer' },
  OfferExpiring: { title: 'Reminder: your offer is waiting for your answer' },
  OfferExpired: { title: 'Your offer has expired' },
  OfferWithdrawn: { title: 'Your offer has been withdrawn' },
  DataRequestRefused: { title: 'About your request to erase your data', page: 'profile' },
  EmploymentVerified: { title: 'Your UCAA employment details are verified', page: 'profile' },
  EmploymentDiscrepancy: { title: 'Your UCAA employment details need correcting', page: 'profile' }
};

const PAGES = {
  Internal: { profile: '/careers/profile', applications: '/careers/applications' },
  External: { profile: '/dashboard/profile', applications: '/dashboard/applications' }
};

function action(candidate, type) {
  const page = EMAILS[type]?.page || 'applications';
  const site = (candidate.candidateType === 'Internal' ? internalFrontendUrl : frontendUrl).replace(/\/$/, '');
  if (!site) return null;
  return {
    label: page === 'profile' ? 'Open my profile' : 'View my applications',
    url: `${site}${(PAGES[candidate.candidateType] || PAGES.External)[page]}`
  };
}

const titleFor = (type) => EMAILS[type]?.title || type.replace(/([A-Z])/g, ' $1').trim();

/** The notice email for a candidate: { subject, html }. */
function noticeEmail(candidate, type, message, { subject, quote } = {}) {
  const title = subject || titleFor(type);
  const { footer, headers } = emailPreferences.emailExtras(candidate);
  return {
    subject: `${title} - UCAA e-Recruitment`,
    headers,
    html: renderEmail({
      audience: 'candidate',
      title,
      preheader: message.slice(0, 120),
      greeting: candidate.fullName ? `Dear ${candidate.fullName},` : 'Hello,',
      text: message,
      quote,
      button: action(candidate, type),
      footerHtml: footer
    })
  };
}

async function notifyCandidate(candidateId, type, message, options = {}) {
  const inApp = options.quote?.text ? `${message} ${options.quote.label}: “${options.quote.text}”` : message;
  await candidateNotificationModel.create({ candidateId, channel: 'InApp', type, message: inApp });

  const candidate = await candidateModel.findById(candidateId);
  if (candidate?.email && candidate.emailNotifications !== false) {
    const icalEvent = options.calendar ? options.calendar(candidate) : null;
    const email = noticeEmail(candidate, type, message, options);
    await sendMail({
      // External candidates hear from careers@, employees from erecruitment@ (utils/mailer.js).
      ...(candidate.candidateType === 'External' ? { from: 'public' } : {}),
      to: candidate.email,
      ...email,
      ...(icalEvent ? { icalEvent } : {})
    });
    await candidateNotificationModel.create({ candidateId, channel: 'Email', type, message: inApp });
  }
}

module.exports = { notifyCandidate, noticeEmail, EMAILS };
