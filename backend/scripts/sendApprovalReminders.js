// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same reasoning as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/sendApprovalReminders.js
//
// Approval requests waiting for someone, worked out per person by the
// Inbox (inboxService.forStaff - their role, delegation, the self-approval
// and conflict-of-interest rules), two ways:
//
// 1. Catching up - a request waiting for someone who was never told about
//    it (it was already pending when approval notices started, or they
//    took on a delegation since) gets them a notice now: one in-app notice
//    per request, opening its review, and one email listing them all. A
//    new request is normally told about the moment it is made
//    (approvalNotificationService); this makes sure nobody is left out.
//
// 2. The daily reminder - on working days from 08:00 (APP_TIMEZONE), once a
//    day, everyone with approvals waiting a day or more gets one in-app
//    notice and one email listing them. The guard is that day's
//    PendingApprovalsDigest notification.
require('dotenv').config();
const prisma = require('../src/config/db');
const inbox = require('../src/services/inboxService');
const notificationModel = require('../src/models/notificationModel');
const { notify, subjectFor, absoluteLink, emailBody } = require('../src/services/notificationService');
const { sendMail } = require('../src/utils/mailer');
const { linkFor, inboxItem } = require('../src/utils/notificationLinks');
const { escapeHtml, timeZone, localDay, dayBounds } = require('../src/utils/interviewFormat');

const HOUR = 60 * 60 * 1000;
const REMIND_AFTER_MS = 20 * HOUR;
const REMIND_FROM_HOUR = 8;

// Working day and hour in APP_TIMEZONE.
function reminderTime(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timeZone(), weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  return !['Sat', 'Sun'].includes(parts.weekday) && Number(parts.hour) >= REMIND_FROM_HOUR;
}

const keyOf = (n) => `${n.taskType}:${n.taskId}`;

// The Inbox's approval items for one person, each with its notice's task.
async function approvalsFor(staff, now) {
  const req = { user: { type: 'staff', id: staff.id, role: staff.role, name: staff.name } };
  const { items } = await inbox.forStaff(req, now);
  const approvals = items.filter((i) => i.notice);
  // A committee's notice is about its exercise, not the vacancy.
  for (const item of approvals) {
    if (item.notice.taskType === 'CommitteeNominationSubmitted') {
      const exercise = await prisma.shortlistExercise.findUnique({ where: { vacancyId: item.notice.vacancyId }, select: { id: true } });
      item.notice = exercise ? { ...item.notice, taskId: exercise.id } : null;
    }
  }
  const out = [];
  for (const item of approvals.filter((i) => i.notice)) {
    const link = item.notice.link ? inboxItem(item.notice.link, '/hr/organisation') : await linkFor(item.notice.taskType, item.notice.taskId);
    out.push({ ...item, link });
  }
  return out;
}

const line = (item) => `${item.kind}: ${item.title}${item.waiting ? ` (${item.waiting})` : ''}`;

function listHtml(intro, items) {
  const rows = items.map((i) => {
    const url = absoluteLink(i.link);
    const text = escapeHtml(line(i));
    return `<li style="margin-bottom:6px">${url ? `<a href="${escapeHtml(url)}">${text}</a>` : text}</li>`;
  }).join('');
  return `<p>${escapeHtml(intro)}</p><ul>${rows}</ul>`;
}

async function emailList(staff, items, { subject, intro }) {
  if (!staff.email) return;
  await sendMail({ to: staff.email, subject, html: emailBody('', '/hr/inbox', listHtml(intro, items)) });
}

async function forPerson(staff, now, remindNow, startOfToday) {
  const approvals = await approvalsFor(staff, now);
  if (!approvals.length) return { caughtUp: 0, reminded: 0 };

  const told = new Set(((await prisma.notification.findMany({
    where: { recipientId: staff.id, OR: approvals.map((a) => ({ taskType: a.notice.taskType, taskId: a.notice.taskId })) },
    select: { taskType: true, taskId: true }
  })) || []).map(keyOf));

  // 1. Catching up.
  const fresh = approvals.filter((a) => !told.has(keyOf(a.notice)));
  for (const item of fresh) {
    await notify(staff.id, item.notice.taskType, item.notice.taskId, `Waiting for your approval - ${line(item)}.`, { link: item.link, email: false });
  }
  if (fresh.length) {
    await emailList(staff, fresh, {
      subject: fresh.length === 1 ? subjectFor(fresh[0].notice.taskType) : `${fresh.length} approvals waiting for you`,
      intro: fresh.length === 1 ? 'This is waiting for your approval in UCAA e-Recruitment:' : 'These are waiting for your approval in UCAA e-Recruitment:'
    });
  }

  // 2. The daily reminder of what has waited a day or more.
  let reminded = 0;
  if (remindNow) {
    const freshKeys = new Set(fresh.map((a) => keyOf(a.notice)));
    const waiting = approvals.filter((a) => !freshKeys.has(keyOf(a.notice)) && a.since && now - new Date(a.since) >= REMIND_AFTER_MS);
    const alreadyToday = waiting.length && await prisma.notification.findFirst({
      where: { recipientId: staff.id, taskType: 'PendingApprovalsDigest', channel: 'InApp', sentAt: { gte: startOfToday } }, select: { id: true }
    });
    if (waiting.length && !alreadyToday) {
      const text = waiting.length === 1
        ? `Still waiting for your approval - ${line(waiting[0])}.`
        : `${waiting.length} approvals are still waiting for you: ${waiting.map(line).join('; ')}.`;
      await notificationModel.create({ recipientId: staff.id, channel: 'InApp', taskType: 'PendingApprovalsDigest', taskId: 0, message: text, link: '/hr/inbox' });
      await emailList(staff, waiting, {
        subject: waiting.length === 1 ? 'An approval is waiting for you' : `${waiting.length} approvals are waiting for you`,
        intro: waiting.length === 1 ? 'This is still waiting for your approval:' : 'These are still waiting for your approval:'
      });
      if (staff.email) await notificationModel.create({ recipientId: staff.id, channel: 'Email', taskType: 'PendingApprovalsDigest', taskId: 0, message: text, link: '/hr/inbox' });
      reminded = waiting.length;
    }
  }
  return { caughtUp: fresh.length, reminded };
}

async function run(now = new Date()) {
  const staff = await prisma.staffUser.findMany({
    where: { active: true, role: { not: null } },
    select: { id: true, role: true, name: true, email: true }
  });
  const remindNow = reminderTime(now);
  const startOfToday = dayBounds(localDay(now)).start;
  let caughtUp = 0; let reminded = 0; let people = 0;
  for (const s of staff) {
    try {
      const result = await forPerson(s, now, remindNow, startOfToday);
      caughtUp += result.caughtUp;
      reminded += result.reminded;
      if (result.caughtUp || result.reminded) people += 1;
    } catch (err) {
      // One person's failure doesn't stop everyone else's notices.
      console.error(`Approval reminders for staff ${s.id} failed:`, err);
    }
  }
  return `Approval reminders: ${people} staff member(s) told - ${caughtUp} approval(s) they hadn't been told about, ${reminded} in daily reminders.`;
}

module.exports = { run, reminderTime };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('sendApprovalReminders', run);
}
