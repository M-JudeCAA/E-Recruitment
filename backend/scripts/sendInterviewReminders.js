// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same reasoning as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/sendInterviewReminders.js
//
// Two jobs in one pass over Scheduled interview rounds:
//
// 1. Reminders - about a day before an interview, the candidate gets an
//    in-app + email reminder and every panelist with an email gets one
//    message covering all of their interviews in that window.
//    InterviewRound.reminderSentAt is the one-time-fire guard (cleared on
//    reschedule, so the new time gets its own reminder).
//
// 2. Results reminders - a day after an interview whose results (the
//    panel's score, verdict and signed score sheet) still aren't recorded,
//    whoever scheduled it is told, once - one notification per person
//    however many interviews. InterviewRound.resultsReminderSentAt is the
//    guard (cleared on reschedule).
require('dotenv').config();
const interviewModel = require('../src/models/interviewModel');
const { notify } = require('../src/services/notificationService');
const { notifyCandidate } = require('../src/services/candidateNotificationService');
const invitations = require('../src/services/interviewInvitationService');

const HOUR = 60 * 60 * 1000;
const REMIND_WITHIN_MS = 24 * HOUR;
const RESULTS_AFTER_MS = 24 * HOUR;

async function sendReminders(now) {
  const due = await interviewModel.dueForReminder(now, new Date(now.getTime() + REMIND_WITHIN_MS));
  for (const round of due) {
    try {
      await notifyCandidate(round.application.candidateId, 'InterviewReminder',
        invitations.candidateMessage('reminder', round, round.application.vacancy.title));
    } catch (err) {
      console.error(`Interview reminder to candidate failed for round ${round.id}:`, err.message);
    }
  }
  const panelEmailed = due.length ? await invitations.emailPanelReminder(due) : 0;
  for (const round of due) await interviewModel.update(round.id, { reminderSentAt: now });
  return { reminded: due.length, panelEmailed };
}

async function sendResultsReminders(now) {
  const overdue = await interviewModel.overdueForResults(new Date(now.getTime() - RESULTS_AFTER_MS));
  const byRecipient = new Map(); // staff id -> [round]
  for (const round of overdue) {
    const recipient = round.scheduledById || round.application.vacancy.createdById;
    if (!recipient) continue;
    if (!byRecipient.has(recipient)) byRecipient.set(recipient, []);
    byRecipient.get(recipient).push(round);
  }

  const describe = (round) => `${round.application.candidate.fullName} (${round.application.vacancy.jobRef}, round ${round.roundNumber})`;
  let sent = 0;
  for (const [recipient, rounds] of byRecipient) {
    try {
      await notify(recipient, 'InterviewResultsOverdue', rounds[0].id,
        `The results of ${rounds.length} interview${rounds.length === 1 ? '' : 's'} held more than a day ago are still not recorded: `
        + `${rounds.map(describe).join('; ')}. Collect the panel's signed score sheets and record the results in the Interview Hub, `
        + 'or mark a candidate who did not attend as a no-show.');
      sent += 1;
    } catch (err) {
      console.error(`Interview results reminder to staff user ${recipient} failed:`, err.message);
    }
  }
  for (const round of overdue) await interviewModel.update(round.id, { resultsReminderSentAt: now });
  return { overdue: overdue.length, notices: sent };
}

async function run() {
  const now = new Date();
  const reminders = await sendReminders(now);
  const results = await sendResultsReminders(now);
  return `Interview reminders complete. ${reminders.reminded} candidate reminder(s), `
    + `${reminders.panelEmailed} panelist email(s), ${results.notices} results reminder(s) covering ${results.overdue} interview(s).`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('sendInterviewReminders', run);
}
