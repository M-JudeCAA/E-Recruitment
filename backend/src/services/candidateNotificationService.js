const candidateNotificationModel = require('../models/candidateNotificationModel');
const candidateModel = require('../models/candidateModel');
const { sendMail } = require('../utils/mailer');
const emailPreferences = require('./emailPreferenceService');

// Same dual-channel pairing principle as notificationService.notify() for
// staff: always in-app, and emailed too unless the candidate has turned
// notice emails off (Candidate.emailNotifications, emailPreferenceService).
// Every email carries the link to turn them off.
//
// options.calendar(candidate) may return an icalEvent ({ method, content,
// filename }) for the email - an interview invitation the candidate's
// calendar picks up, in the same email as the message. options.subject
// overrides the subject worked out from the type.
async function notifyCandidate(candidateId, type, message, options = {}) {
  await candidateNotificationModel.create({ candidateId, channel: 'InApp', type, message });

  const candidate = await candidateModel.findById(candidateId);
  if (candidate?.email && candidate.emailNotifications !== false) {
    const icalEvent = options.calendar ? options.calendar(candidate) : null;
    const { footer, headers } = emailPreferences.emailExtras(candidate);
    await sendMail({
      to: candidate.email,
      subject: options.subject || type.replace(/([A-Z])/g, ' $1').trim(),
      html: `<p>${message}</p>${footer}`,
      headers,
      ...(icalEvent ? { icalEvent } : {})
    });
    await candidateNotificationModel.create({ candidateId, channel: 'Email', type, message });
  }
}

module.exports = { notifyCandidate };
