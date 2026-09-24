// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same reasoning as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/checkVacancyDeadlines.js
//
// Vacancy.status is deliberately never mutated just because a deadline
// lapsed (it reflects fill-count vs positionsRequired, computed elsewhere -
// see the schema comment on VacancyStatus) - a deadline passing is purely
// a notification-worthy event for HR, not a status transition. Candidate-
// facing visibility for a lapsed vacancy is handled separately, in
// vacancyController.listPublic's own deadline filter.
// Loads SMTP_* etc. from backend/.env when run directly. Prisma reads
// DATABASE_URL from .env on its own, but the mailer does not - without
// this, emails sent from a cron-run script always failed.
require('dotenv').config();
const prisma = require('../src/config/db');
const { notify } = require('../src/services/notificationService');

async function run() {
  const now = new Date();

  // deadlineNotifiedAt: null is the one-time-fire guard (same idiom as
  // Candidate.profileCompletedAt) - without it, every hourly run would
  // re-notify the same vacancy for as long as it stays Open/PartiallyFilled
  // past its deadline.
  const passed = await prisma.vacancy.findMany({
    where: {
      status: { in: ['Open', 'PartiallyFilled'] },
      deadline: { lt: now },
      deadlineNotifiedAt: null
    }
  });

  for (const vacancy of passed) {
    // Excludes Draft, same as applicationModel.findByVacancy - a draft was
    // never seen by HR and isn't a real applicant count to report here.
    const applicationCount = await prisma.application.count({
      where: { vacancyId: vacancy.id, status: { not: 'Draft' } }
    });

    const reviewNote = vacancy.reviewStartedAt
      ? 'The review queue is already open.'
      : 'Open the review queue from the vacancy page to begin screening.';
    const message = `The application deadline for ${vacancy.jobRef} (${vacancy.title}) passed on `
      + `${vacancy.deadline.toLocaleDateString()}. ${applicationCount} application${applicationCount === 1 ? '' : 's'} `
      + `${applicationCount === 1 ? 'was' : 'were'} received. ${reviewNote}`;

    await notify(vacancy.createdById, 'VacancyDeadlinePassed', vacancy.id, message);
    await prisma.vacancy.update({ where: { id: vacancy.id }, data: { deadlineNotifiedAt: now } });
  }

  return `Vacancy deadline check complete. ${passed.length} vacancy(ies) notified.`;
}

module.exports = { run };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('checkVacancyDeadlines', run);
}
