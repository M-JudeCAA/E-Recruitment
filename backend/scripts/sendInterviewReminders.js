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
// 2. Score nudges - a day after an interview that still has no finalized
//    recommendation, whoever scheduled it is told either that panel scores
//    are missing or that everything is in and it's ready to finalize.
//    One notification per recipient per kind, however many rounds.
//    InterviewRound.scoreNudgeSentAt is the guard.
require('dotenv').config();
const interviewModel = require('../src/models/interviewModel');
const { notify } = require('../src/services/notificationService');
const { notifyCandidate } = require('../src/services/candidateNotificationService');
const invitations = require('../src/services/interviewInvitationService');
const { panelProgress } = require('../src/services/interviewService');

const HOUR = 60 * 60 * 1000;
const REMIND_WITHIN_MS = 24 * HOUR;
const NUDGE_AFTER_MS = 24 * HOUR;

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
  const panelEmailed = due.length ? await invitations.emailPanel(due, 'reminder') : 0;
  for (const round of due) await interviewModel.update(round.id, { reminderSentAt: now });
  return { reminded: due.length, panelEmailed };
}

async function sendScoreNudges(now) {
  const overdue = await interviewModel.overdueForScores(new Date(now.getTime() - NUDGE_AFTER_MS));
  // recipientId -> { missing: [round], ready: [round] }
  const byRecipient = new Map();
  for (const round of overdue) {
    const recipient = round.scheduledById || round.application.vacancy.createdById;
    if (!recipient) continue;
    if (!byRecipient.has(recipient)) byRecipient.set(recipient, { missing: [], ready: [] });
    const progress = panelProgress(round.panelMembers);
    byRecipient.get(recipient)[progress.complete ? 'ready' : 'missing'].push({ round, progress });
  }

  const describe = ({ round, progress }) => `${round.application.candidate.fullName} (${round.application.vacancy.jobRef}, round ${round.roundNumber}`
    + `${progress.complete ? '' : `, ${progress.scored} of ${progress.total} scores in`})`;
  let sent = 0;
  for (const [recipient, { missing, ready }] of byRecipient) {
    try {
      if (missing.length) {
        await notify(recipient, 'InterviewScoresOverdue', missing[0].round.id,
          `Panel scores are still missing for ${missing.length} interview${missing.length === 1 ? '' : 's'} held more than a day ago: `
          + `${missing.map(describe).join('; ')}. Send the panel their scoring links or record the scores from the Interview Hub.`);
        sent += 1;
      }
      if (ready.length) {
        await notify(recipient, 'InterviewReadyToFinalize', ready[0].round.id,
          `${ready.length} interview${ready.length === 1 ? ' has' : 's have'} every panel score in but no recommendation yet: `
          + `${ready.map(describe).join('; ')}. Finalize them from the Interview Hub.`);
        sent += 1;
      }
    } catch (err) {
      console.error(`Interview score nudge to staff user ${recipient} failed:`, err.message);
    }
  }
  for (const round of overdue) await interviewModel.update(round.id, { scoreNudgeSentAt: now });
  return { nudged: overdue.length, notices: sent };
}

async function run() {
  const now = new Date();
  const reminders = await sendReminders(now);
  const nudges = await sendScoreNudges(now);
  return `Interview reminders complete. ${reminders.reminded} candidate reminder(s), `
    + `${reminders.panelEmailed} panelist email(s), ${nudges.notices} score notice(s) covering ${nudges.nudged} interview(s).`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('sendInterviewReminders', run);
}
