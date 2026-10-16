// One-off: gives vacancies that were created before screening was suggested
// from the requisition the screening their Essential Requirements call for
// (utils/screeningSuggestions.js) - minimum education and experience, the
// preferred field of study, and the field of study as a Disqualifying
// question answered with the certificate.
//
//   node scripts/applyScreeningSuggestions.js            what it would change (nothing is written)
//   node scripts/applyScreeningSuggestions.js --yes      apply it
//   ... --vacancy <id or job reference>                  one vacancy only
//
// Only vacancies waiting for approval or still taking applications, and only
// fields that are empty - nothing HR set is overwritten. Each change is in
// the vacancy's history (AuditLog). People who already applied are not
// re-screened here: Begin Review flags anyone below the new minimums for HR,
// and nobody is rejected by it. A draft is asked the new question at submit.
require('dotenv').config();
const prisma = require('../src/config/db');
const audit = require('../src/services/auditService');
const { backfillFor } = require('../src/utils/screeningSuggestions');

const FIELDS = ['minimumEducationLevel', 'minimumExperienceYears', 'preferredFieldOfStudy', 'disqualifyingRequirements', 'desirableRequirements'];
const LABELS = {
  minimumEducationLevel: 'minimum education', minimumExperienceYears: 'minimum experience (years)',
  preferredFieldOfStudy: 'preferred field of study', disqualifyingRequirements: 'Disqualifying question', desirableRequirements: 'Qualifying questions'
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function describe(key, value) {
  if (key === 'disqualifyingRequirements') return `"${value[0].text}" (No stops the application; Yes needs evidence: ${value[0].evidenceLabel})`;
  if (key === 'desirableRequirements') return `${value.length} left`;
  return String(value);
}

async function run({ apply = false, only } = {}) {
  const where = { status: { in: ['PendingApproval', 'Returned', 'Open', 'PartiallyFilled'] } };
  if (only) where.OR = [{ jobRef: String(only) }, ...(/^\d+$/.test(String(only)) ? [{ id: Number(only) }] : [])];
  const vacancies = await prisma.vacancy.findMany({
    where,
    orderBy: { id: 'asc' },
    select: {
      id: true, jobRef: true, title: true, status: true, deadline: true, essentialRequirements: true,
      minimumEducationLevel: true, minimumExperienceYears: true, preferredFieldOfStudy: true,
      disqualifyingRequirements: true, desirableRequirements: true,
      _count: { select: { applications: { where: { status: { not: 'Draft' } } } } }
    }
  });

  let changed = 0;
  for (const v of vacancies) {
    const plan = backfillFor(v);
    console.log(`\n${v.jobRef} - ${v.title} (${v.status}, ${v._count.applications} applied)`);
    if (plan.skipped) {
      console.log(`  skipped: ${plan.skipped}`);
      continue;
    }
    for (const [key, value] of Object.entries(plan.changes)) console.log(`  ${apply ? 'set' : 'would set'} ${LABELS[key]}: ${describe(key, value)}`);
    for (const note of plan.notes) console.log(`  note: ${note}`);
    if (!Object.keys(plan.changes).length) continue;
    changed += 1;
    if (!apply) continue;

    await prisma.vacancy.update({ where: { id: v.id }, data: plan.changes });
    await audit.record({
      entityType: 'Vacancy', entityId: v.id, action: 'Screening set from the Essential Requirements',
      before: v, after: { ...v, ...plan.changes }, fields: FIELDS,
      comment: 'Set from the advert\'s Essential Requirements, which were not checked when candidates applied. '
        + 'Applicants who already applied are flagged at review if below them, not rejected.'
    });
  }
  console.log(`\n${changed} vacanc${changed === 1 ? 'y' : 'ies'} ${apply ? 'updated' : 'would be updated'}.`
    + (apply || !changed ? '' : ' Run again with --yes to apply.'));
  return { changed };
}

module.exports = { run };

if (require.main === module) {
  run({ apply: process.argv.includes('--yes'), only: arg('vacancy') })
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
