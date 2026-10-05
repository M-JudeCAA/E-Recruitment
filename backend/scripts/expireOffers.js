// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same reasoning as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/expireOffers.js
//
// Two jobs in one pass over issued (Approved) offers:
//
// 1. Reminders - within two days of the response deadline, the candidate
//    gets one in-app + email reminder. Offer.responseReminderSentAt is the
//    one-time-fire guard.
//
// 2. Expiry - once the deadline has passed unanswered, the offer becomes
//    Expired, which releases the position to the next reserve on the merit
//    list (workflowService.closeOffer, same as a decline). The candidate is
//    told, and so is every Principal_HR_Officer, naming who moved up.
//
// Offers issued before response deadlines existed have none, so never expire.
require('dotenv').config();
const prisma = require('../src/config/db');
const workflow = require('../src/services/workflowService');
const offerService = require('../src/services/offerService');
const hiringManagers = require('../src/services/hiringManagerService');
const { notifyCandidate } = require('../src/services/candidateNotificationService');
const { formatWhen } = require('../src/utils/interviewFormat');

const REMIND_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;

async function sendReminders(now) {
  const due = await offerService.findDueForReminder(now, REMIND_WITHIN_MS);
  let sent = 0;
  for (const offer of due) {
    try {
      await notifyCandidate(offer.application.candidateId, 'OfferExpiring',
        `A reminder that your offer for "${offer.application.vacancy.title}" needs your answer by ${formatWhen(offer.responseDeadline)}. `
        + 'Please log in to accept or decline it before then.');
      sent += 1;
    } catch (err) {
      console.error(`Offer reminder failed for offer ${offer.id}:`, err.message);
    }
    await prisma.offer.update({ where: { id: offer.id }, data: { responseReminderSentAt: now } });
  }
  return sent;
}

async function expireOverdue(now) {
  const overdue = await offerService.findOverdue(now);
  let expired = 0;
  for (const offer of overdue) {
    const result = await workflow.closeOffer(offer.id, ['Approved'], { status: 'Expired', decidedAt: now });
    // Accepted or declined between the read and the write - nothing to do.
    if (result.conflict) continue;
    expired += 1;
    try {
      await notifyCandidate(offer.application.candidateId, 'OfferExpired',
        `Your offer for "${offer.application.vacancy.title}" has lapsed because we did not receive your answer by ${formatWhen(offer.responseDeadline)}. `
        + 'Please contact HR if you believe this is a mistake.');
    } catch (err) {
      console.error(`Offer expiry notice to candidate failed for offer ${offer.id}:`, err.message);
    }
    await offerService.notifyPositionReleased('OfferExpired', offer.id, offer.application.vacancy, offer.applicationId,
      `expired without an answer from ${offer.application.candidate?.fullName || 'the candidate'}`, result.promoted);
    const promotedName = result.promoted
      ? (await prisma.candidate.findUnique({ where: { id: result.promoted.candidateId }, select: { fullName: true } }))?.fullName
      : null;
    await hiringManagers.notify(offer.application.vacancy, 'offerNotTaken', {
      candidateName: offer.application.candidate?.fullName || 'the candidate', outcome: 'not answered in time, so it lapsed', promotedName
    });
  }
  return expired;
}

async function run() {
  const now = new Date();
  const reminded = await sendReminders(now);
  const expired = await expireOverdue(now);
  return `Offer deadlines checked. ${reminded} reminder(s) sent, ${expired} offer(s) expired.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('expireOffers', run);
}
