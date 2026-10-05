const candidateNotificationModel = require('../models/candidateNotificationModel');
const candidateModel = require('../models/candidateModel');
const { sendMail } = require('../utils/mailer');

// Same dual-channel pairing principle as notificationService.notify() for
// staff, but candidates always have an email (unlike staff, whose email is
// optional there), so the email send is unconditional here.
//
// options.calendar(candidate) may return an icalEvent ({ method, content,
// filename }) for the email - an interview invitation the candidate's
// calendar picks up, in the same email as the message.
async function notifyCandidate(candidateId, type, message, options = {}) {
  await candidateNotificationModel.create({ candidateId, channel: 'InApp', type, message });

  const candidate = await candidateModel.findById(candidateId);
  if (candidate?.email) {
    const icalEvent = options.calendar ? options.calendar(candidate) : null;
    await sendMail({
      to: candidate.email,
      subject: type.replace(/([A-Z])/g, ' $1').trim(),
      html: `<p>${message}</p>`,
      ...(icalEvent ? { icalEvent } : {})
    });
    await candidateNotificationModel.create({ candidateId, channel: 'Email', type, message });
  }
}

module.exports = { notifyCandidate };
