const candidateNotificationModel = require('../models/candidateNotificationModel');
const candidateModel = require('../models/candidateModel');
const { sendMail } = require('../utils/mailer');

// Same dual-channel pairing principle as notificationService.notify() for
// staff, but candidates always have an email (unlike staff, whose email is
// optional there), so the email send is unconditional here.
async function notifyCandidate(candidateId, type, message) {
  await candidateNotificationModel.create({ candidateId, channel: 'InApp', type, message });

  const candidate = await candidateModel.findById(candidateId);
  if (candidate?.email) {
    await sendMail({
      to: candidate.email,
      subject: type.replace(/([A-Z])/g, ' $1').trim(),
      html: `<p>${message}</p>`
    });
    await candidateNotificationModel.create({ candidateId, channel: 'Email', type, message });
  }
}

module.exports = { notifyCandidate };
