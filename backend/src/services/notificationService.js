const notificationModel = require('../models/notificationModel');
const staffModel = require('../models/staffModel');
const { sendMail } = require('../utils/mailer'); // existing utility, reused rather than duplicated
const { staffFrontendUrl } = require('../config/frontendUrl');
const { linkFor } = require('../utils/notificationLinks');
const { renderEmail } = require('../utils/emailLayout');

// Sends both channels for one recipient - in-app and email are always
// paired, never one without the other, matching the "dual-channel"
// requirement exactly rather than treating email as an afterthought.
//
// Each notification carries where opening it takes the reader (`link`, a
// staff-app path; utils/notificationLinks.js works it out from the task
// when not given) - the bell goes there, and the email has the same link.
// `subject` overrides the email subject, `emailHtml` the email body (the
// in-app text stays `message`); `email: false` sends the in-app notice
// only, for a caller that emails several notices as one.

const SUBJECTS = {
  VacancyApproval: 'Approval needed: vacancy',
  OfferApproval: 'Approval needed: offer',
  ShortlistProposed: 'Approval needed: interview shortlist',
  MeritListProposed: 'Approval needed: merit list',
  CommitteeNominationSubmitted: 'Approval needed: shortlisting committee',
  DirectorateApproval: 'Approval needed: directorate',
  DepartmentApproval: 'Approval needed: department',
  PositionApproval: 'Approval needed: position',
  PendingApprovalsDigest: 'Approvals waiting for you'
};

const subjectFor = (taskType) => SUBJECTS[taskType] || `Action needed: ${taskType.replace(/([A-Z])/g, ' $1').trim()}`;

// The full address of a staff-app path, for emails.
function absoluteLink(link) {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return staffFrontendUrl ? `${staffFrontendUrl.replace(/\/$/, '')}${link}` : null;
}

// A staff email in the standard design (utils/emailLayout.js): the subject
// as its heading, the message (escaped here) or the caller's html, and a
// button to where it is about.
function emailBody(message, link, html, title) {
  const url = absoluteLink(link);
  return renderEmail({
    audience: 'staff',
    title,
    preheader: message ? String(message).slice(0, 120) : undefined,
    text: html ? undefined : message,
    bodyHtml: html || undefined,
    button: url ? { label: 'Open in e-Recruitment', url } : null
  });
}

async function notify(recipientId, taskType, taskId, message, { link, subject, emailHtml, email = true } = {}) {
  const path = link || await linkFor(taskType, taskId).catch(() => null);
  await notificationModel.create({ recipientId, channel: 'InApp', taskType, taskId, message, link: path });

  if (!email) return;
  const staff = await staffModel.findById(recipientId);
  if (staff?.email) {
    await sendMail({
      to: staff.email,
      subject: subject || subjectFor(taskType),
      html: emailBody(message, path, emailHtml, subject || subjectFor(taskType))
    });
    await notificationModel.create({ recipientId, channel: 'Email', taskType, taskId, message, link: path });
  }
}

async function notifyAllWithRole(role, taskType, taskId, message, options) {
  const prisma = require('../config/db');
  const recipients = await prisma.staffUser.findMany({ where: { role, active: true }, select: { id: true } });
  await Promise.all(recipients.map((r) => notify(r.id, taskType, taskId, message, options)));
}

// Everyone in HR: active staff holding an HR role (an accounts-only system
// administrator has none), except exceptIds.
async function notifyAllHrStaff(taskType, taskId, message, { exceptIds = [], ...options } = {}) {
  const prisma = require('../config/db');
  const recipients = await prisma.staffUser.findMany({
    where: { role: { not: null }, active: true, ...(exceptIds.length ? { id: { notIn: exceptIds } } : {}) },
    select: { id: true }
  });
  await Promise.all(recipients.map((r) => notify(r.id, taskType, taskId, message, options)));
}

module.exports = { notify, notifyAllWithRole, notifyAllHrStaff, absoluteLink, subjectFor, emailBody };
