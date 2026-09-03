// Default SLA durations - policy numbers UCAA has not specified, so
// these are placeholders, not settled decisions. Stored in SlaPolicy
// (a real table) specifically so they can be tuned later without a code
// change - see the schema.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULTS = [
  { taskType: 'DepartmentApproval', tier: 'Principal_HR_Officer', durationHours: 48 },
  { taskType: 'DepartmentApproval', tier: 'Manager', durationHours: 48 },
  { taskType: 'OfferApproval', tier: 'Manager', durationHours: 24 },
  { taskType: 'OfferApproval', tier: 'Director', durationHours: 48 },
];

async function main() {
  for (const policy of DEFAULTS) {
    await prisma.slaPolicy.upsert({
      where: { taskType_tier: { taskType: policy.taskType, tier: policy.tier } },
      update: { durationHours: policy.durationHours },
      create: policy
    });
  }
  console.log(`Seeded ${DEFAULTS.length} default SLA policies (placeholder durations - confirm with UCAA).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
