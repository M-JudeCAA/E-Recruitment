// Run on a schedule (e.g. daily via cron), same reasoning as
// checkSlaEscalations.js - scheduled logic belongs outside the
// request-serving Node process.
// 0 6 * * * cd /path/to/backend && node scripts/checkVacancyDeadlines.js
const prisma = require('../src/config/db');
const applicationModel = require('../src/models/applicationModel');
const notificationModel = require('../src/models/notificationModel');
const { notify } = require('../src/services/notificationService');

const TASK_TYPE = 'VacancyDeadlinePassed';

async function main() {
  const now = new Date();

  // Still Open/PartiallyFilled (Filled/Closed vacancies have nothing left
  // to act on) and reviewStartedAt still null - once Begin Review has run
  // for a vacancy, HR is already in its review queue, so a "go start
  // reviewing" nudge would be redundant. deadline is nullable, so this
  // also naturally excludes vacancies with no deadline set.
  const candidates = await prisma.vacancy.findMany({
    where: {
      deadline: { lt: now },
      status: { in: ['Open', 'PartiallyFilled'] },
      reviewStartedAt: null
    }
  });

  let notified = 0;

  for (const vacancy of candidates) {
    // Idempotency - without this, a second run would re-notify for the
    // same vacancy every time it fires (the exact duplicate this feature
    // replaces; see prisma/migrations/README_notification_task_types.md).
    const existing = await notificationModel.findByTask(TASK_TYPE, vacancy.id);
    if (existing) continue;

    const applicationCount = await applicationModel.countByVacancy(vacancy.id);
    const deadlineStr = vacancy.deadline.toLocaleDateString('en-GB');

    await notify(
      vacancy.createdById,
      TASK_TYPE,
      vacancy.id,
      `The application deadline for ${vacancy.jobRef} (${vacancy.title}) passed on ${deadlineStr}. ` +
      `${applicationCount} application${applicationCount === 1 ? ' was' : 's were'} received. ` +
      `Open the review queue from the vacancy page to begin screening.`
    );
    notified++;
  }

  console.log(`Vacancy deadline check complete. ${notified} vacancy(ies) notified.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
