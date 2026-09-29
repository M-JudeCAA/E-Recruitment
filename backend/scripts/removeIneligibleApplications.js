// One-off clean-up for applications submitted before screening moved to the
// point of application: finds every application still in the applicant pool
// whose candidate fails the vacancy's screening today (a structured minimum
// on their current profile, or a Disqualifying question answered the wrong
// way - screeningService.assessEligibility, the same rules submit() now
// enforces) and takes it out of the pool.
//
// Dry run by default - prints what it would change and writes nothing:
//   node scripts/removeIneligibleApplications.js
// Apply:
//   node scripts/removeIneligibleApplications.js --apply
//
// "Removed" means moved to Rejected with a rejectionReason listing why -
// not deleted - so the audit trail survives and HR can still see who was
// screened out. No candidate notification is sent. Only applications still
// before shortlist approval (Submitted, UnderReview, ShortlistProposed) are
// touched; ineligible ones further along (Shortlisted and later) are only
// reported, since they already have interviews/offers hanging off them and
// need a human decision. Missing academic documents are NOT a reason here -
// that requirement is new and older applications could not have met it.
require('dotenv').config();
const prisma = require('../src/config/db');
const { assessEligibility } = require('../src/services/screeningService');

const REMOVABLE_STATUSES = ['Submitted', 'UnderReview', 'ShortlistProposed'];
const REPORT_ONLY_STATUSES = ['Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered'];

async function main() {
  const apply = process.argv.includes('--apply');

  const applications = await prisma.application.findMany({
    where: { status: { in: [...REMOVABLE_STATUSES, ...REPORT_ONLY_STATUSES] } },
    include: {
      vacancy: true,
      candidate: { include: { education: true, workExperience: true, examGrades: true } }
    },
    orderBy: [{ vacancyId: 'asc' }, { id: 'asc' }]
  });

  const ineligible = applications
    .map((application) => ({ application, result: assessEligibility(application, application.candidate, application.vacancy) }))
    .filter(({ result }) => !result.eligible);

  const toRemove = ineligible.filter(({ application }) => REMOVABLE_STATUSES.includes(application.status));
  const reportOnly = ineligible.filter(({ application }) => REPORT_ONLY_STATUSES.includes(application.status));

  const describe = ({ application, result }) =>
    `  #${application.id} ${application.candidate.fullName} - ${application.vacancy.jobRef} "${application.vacancy.title}" [${application.status}]\n` +
    result.reasons.map((r) => `      - ${r}`).join('\n');

  console.log(`Checked ${applications.length} application(s) in the pool; ${ineligible.length} fail screening.\n`);
  console.log(`${toRemove.length} to remove from the pool (moved to Rejected):`);
  toRemove.forEach((row) => console.log(describe(row)));
  if (reportOnly.length > 0) {
    console.log(`\n${reportOnly.length} further along (NOT changed - review by hand):`);
    reportOnly.forEach((row) => console.log(describe(row)));
  }

  if (!apply) {
    console.log('\nDry run - nothing was changed. Re-run with --apply to remove them.');
    return;
  }

  let removed = 0;
  for (const { application, result } of toRemove) {
    // Status-guarded so a row that moved on since it was read is skipped.
    const { count } = await prisma.application.updateMany({
      where: { id: application.id, status: application.status },
      data: {
        status: 'Rejected',
        rejectedAt: new Date(),
        rejectionReason: `Does not meet the screening requirements: ${result.reasons.join('; ')}`,
        screeningPassed: false,
        screeningReasons: JSON.stringify(result.reasons),
        screenedAt: new Date(),
        rank: null,
        listStatus: null
      }
    });
    removed += count;
  }
  console.log(`\nRemoved ${removed} application(s) from the pool.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
