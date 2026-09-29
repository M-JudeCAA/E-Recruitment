// Run on a schedule (the scheduler worker runs it every few minutes - see
// FAST_JOBS in scheduler.js), not as a timer inside the API.
// */5 * * * * cd /path/to/backend && node scripts/checkInterviewSessions.js
//
// Panelists can only score once HR starts a vacancy's interview session for
// the day (InterviewDay). If it still hasn't been started 30 minutes after
// the first interview of the day was due, whoever scheduled those interviews
// is told, so they can start it or decide to reschedule or cancel. Once per
// vacancy-day: InterviewDay.notStartedAlertAt is the guard.
require('dotenv').config();
const interviewModel = require('../src/models/interviewModel');
const interviewDayModel = require('../src/models/interviewDayModel');
const { notify } = require('../src/services/notificationService');
const { localDay, formatDay, formatWhen } = require('../src/utils/interviewFormat');

const MINUTE = 60 * 1000;
const NOT_STARTED_AFTER_MS = 30 * MINUTE;
// How far back to look - a session that was never started yesterday still
// gets its one alert if the worker was down at the time.
const LOOK_BACK_MS = 24 * 60 * MINUTE;

async function run(now = new Date()) {
  const due = await interviewModel.scheduledDue(
    new Date(now.getTime() - LOOK_BACK_MS), new Date(now.getTime() - NOT_STARTED_AFTER_MS)
  );

  // vacancyId|day -> the day's still-open rounds, earliest first
  const byDay = new Map();
  for (const round of due) {
    const vacancy = round.application.vacancy;
    const key = `${vacancy.id}|${localDay(round.scheduledDate)}`;
    if (!byDay.has(key)) byDay.set(key, { vacancy, day: localDay(round.scheduledDate), rounds: [] });
    byDay.get(key).rounds.push(round);
  }

  let alerted = 0;
  for (const { vacancy, day, rounds } of byDay.values()) {
    const existing = await interviewDayModel.find(vacancy.id, day);
    if (existing?.startedAt || existing?.notStartedAlertAt) continue;
    const row = existing || await interviewDayModel.ensure(vacancy.id, day);
    // Conditional write - a second worker (or a session started meanwhile)
    // makes this 0 and nobody is told twice.
    const claimed = await interviewDayModel.markNotStartedAlert(row.id, now);
    if (claimed.count === 0) continue;

    const first = rounds[0];
    const recipients = new Set(rounds.map((r) => r.scheduledById || vacancy.createdById).filter(Boolean));
    const message = `The interview session for ${vacancy.jobRef} ${vacancy.title} on ${formatDay(day)} has not been started. `
      + `The first interview was due at ${formatWhen(first.scheduledDate)}, and ${rounds.length} candidate${rounds.length === 1 ? ' is' : 's are'} waiting to be interviewed. `
      + 'Panelists cannot score until it is started. Start the session in the Interview Hub, or reschedule or cancel the interviews.';
    for (const recipientId of recipients) {
      try {
        await notify(recipientId, 'InterviewSessionNotStarted', first.id, message);
      } catch (err) {
        console.error(`Could not send the session-not-started notice to staff ${recipientId}:`, err.message);
      }
    }
    alerted += 1;
  }
  return `${alerted} interview session(s) not started - HR notified`;
}

module.exports = { run, NOT_STARTED_AFTER_MS };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('checkInterviewSessions', () => run());
}
