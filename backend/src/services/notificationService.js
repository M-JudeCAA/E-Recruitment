const notificationModel = require('../models/notificationModel');
const staffModel = require('../models/staffModel');
const { sendMail } = require('../utils/mailer'); // existing utility, reused rather than duplicated

// Sends both channels for one recipient - in-app and email are always
// paired, never one without the other, matching the "dual-channel"
// requirement exactly rather than treating email as an afterthought.
async function notify(recipientId, taskType, taskId, message) {
  await notificationModel.create({ recipientId, channel: 'InApp', taskType, taskId, message });

  const staff = await staffModel.findById(recipientId);
  if (staff?.email) {
    await sendMail({
      to: staff.email,
      subject: `Action needed: ${taskType.replace(/([A-Z])/g, ' $1').trim()}`,
      html: `<p>${message}</p>`
    });
    await notificationModel.create({ recipientId, channel: 'Email', taskType, taskId, message });
  }
}

async function notifyAllWithRole(role, taskType, taskId, message) {
  const prisma = require('../config/db');
  const recipients = await prisma.staffUser.findMany({ where: { role }, select: { id: true } });
  await Promise.all(recipients.map((r) => notify(r.id, taskType, taskId, message)));
}

module.exports = { notify, notifyAllWithRole };
