// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same reasoning as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/sendDiscrepancyReminders.js
//
// An internal candidate whose employment details HR flagged as not matching
// its records can't apply until they correct them (or HR is satisfied
// otherwise). While the discrepancy stands they are reminded once a day -
// in-app, and by email unless they turned notice emails off - for the seven
// days after the day it was flagged, from 08:00 APP_TIMEZONE. Correcting the
// details (back to Pending) or a new decision stops them; a new flag starts
// seven more. InternalProfile.discrepancyReminders/discrepancyRemindedAt are
// the guard (internalVerificationService.decide resets them).
require('dotenv').config();
const prisma = require('../src/config/db');
const { notifyCandidate } = require('../src/services/candidateNotificationService');
const { hrComment } = require('../src/services/internalVerificationService');
const { localDay, zonedDateTime } = require('../src/utils/interviewFormat');
const { employmentCheckRequired } = require('../src/utils/employmentCheck');

const MAX_REMINDERS = 7;
const FROM_TIME = '08:00';

function message(daysOpen, left) {
  return `HR found ${daysOpen === 1 ? 'yesterday' : `${daysOpen} days ago`} that the UCAA employment details on your profile don’t match HR records, `
    + 'and they have not been corrected yet.\n\n'
    + 'Please check them on your profile and correct anything that is wrong - saving them sends them back to HR to check again. '
    + 'If you believe they are right, contact HR.\n\n'
    + `You can submit applications for internal vacancies once your details are verified.${left === 0 ? ' This is the last reminder.' : ''}`;
}

// Whole days between two YYYY-MM-DD days.
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** The profiles due a reminder now: flagged, under 7 reminders, none yet today and not flagged today. */
async function dueNow(now) {
  const today = localDay(now);
  if (now < zonedDateTime(today, FROM_TIME)) return [];
  const flagged = await prisma.internalProfile.findMany({
    where: {
      verificationStatus: 'Discrepancy_Flagged',
      verifiedDate: { not: null },
      discrepancyReminders: { lt: MAX_REMINDERS },
      candidate: { candidateType: 'Internal', purgedAt: null }
    },
    select: { candidateId: true, verifiedDate: true, verificationComments: true, discrepancyReminders: true, discrepancyRemindedAt: true }
  }) || [];
  return flagged.filter((p) => localDay(p.verifiedDate) !== today
    && (!p.discrepancyRemindedAt || localDay(p.discrepancyRemindedAt) !== today));
}

async function run(now = new Date()) {
  // Nothing to put right while the check is switched off (a test server).
  if (!employmentCheckRequired()) return 'Discrepancy reminders skipped - the employment check is switched off (EMPLOYMENT_CHECK_REQUIRED=false).';
  const due = await dueNow(now);
  let sent = 0;
  for (const profile of due) {
    const count = profile.discrepancyReminders + 1;
    // Claim it first, only if nothing else has (another run, a decision),
    // so one is never sent twice.
    const claimed = await prisma.internalProfile.updateMany({
      where: { candidateId: profile.candidateId, verificationStatus: 'Discrepancy_Flagged', discrepancyReminders: profile.discrepancyReminders },
      data: { discrepancyReminders: count, discrepancyRemindedAt: now }
    });
    if (!claimed.count) continue;
    try {
      await notifyCandidate(profile.candidateId, 'EmploymentDiscrepancy',
        message(daysBetween(localDay(profile.verifiedDate), localDay(now)), MAX_REMINDERS - count),
        { subject: 'Reminder: your UCAA employment details need correcting', quote: hrComment(profile.verificationComments) });
      sent += 1;
    } catch (err) {
      console.error(`Discrepancy reminder to candidate ${profile.candidateId} failed:`, err.message);
    }
  }
  return `Discrepancy reminders complete. ${sent} reminder(s) sent.`;
}

module.exports = { run, dueNow, MAX_REMINDERS };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('sendDiscrepancyReminders', run);
}
