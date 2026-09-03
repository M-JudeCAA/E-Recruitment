// Seeds the six real Directorates and every real Department/Directorate
// pairing evidenced in the Cyber Security Workshop nomination list -
// 29 department rows, including the 5 distinct department-rows named
// "CWG" that each sit under a different directorate. All pre-approved,
// since every one of these is already in active use, not a proposal
// awaiting review.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DIRECTORATES = ['DHRA', 'DANS', 'DAAS', 'DSSER', 'DF', 'CORP'];

// [department name, directorate name] - derived directly from the
// attached participant list, not invented.
const DEPARTMENTS = [
  ['CWG', 'CORP'], ['CWG', 'DANS'], ['CWG', 'DAAS'], ['CWG', 'DSSER'], ['CWG', 'DF'],
  ['AUDIT', 'CORP'], ['IT', 'CORP'], ['IT INT', 'CORP'], ['PDU', 'CORP'],
  ['HR', 'DHRA'], ['LD', 'DHRA'], ['ADMIN', 'DHRA'],
  ['ACCOUNTS', 'DF'], ['FINANCE', 'DF'], ['MGT ACCT', 'DF'],
  ['ASFAL', 'DSSER'], ['FSS', 'DSSER'], ['NCMC', 'DSSER'], ['ANSAS', 'DSSER'], ['SSP', 'DSSER'], ['ER', 'DSSER'],
  ['AVSEC', 'DAAS'], ['EE', 'DAAS'], ['VIP', 'DAAS'], ['ME', 'DAAS'], ['CC', 'DAAS'],
  ['CE', 'DAAS'], ['ARFFS', 'DAAS'], ['OPS', 'DAAS']
];

async function main() {
  const systemUser = await prisma.staffUser.findFirst({ where: { role: 'Director' } });
  if (!systemUser) {
    throw new Error('Seed a Director staff account first - departments need a createdById.');
  }

  const directorateByName = {};
  for (const name of DIRECTORATES) {
    directorateByName[name] = await prisma.directorate.upsert({
      where: { name },
      update: {},
      create: { name, createdById: systemUser.id }
    });
  }
  console.log(`Seeded ${DIRECTORATES.length} directorates.`);

  let created = 0;
  for (const [deptName, directorateName] of DEPARTMENTS) {
    const directorate = directorateByName[directorateName];
    await prisma.department.upsert({
      where: { name_directorateId: { name: deptName, directorateId: directorate.id } },
      update: {},
      create: {
        name: deptName,
        directorateId: directorate.id,
        status: 'Approved',
        createdById: systemUser.id,
        approvedById: systemUser.id,
        approvedAt: new Date()
      }
    });
    created++;
  }
  console.log(`Seeded ${created} department rows (including 5 separate "CWG" rows under different directorates).`);

  console.log('\nNo Position rows are seeded - the source list only contains staff names, not job');
  console.log('titles or seniority levels. Positions need to be entered separately, once real');
  console.log('position/level data is available, via the new Position admin screen.');

  // Backfill departmentId (the real FK admin vacancy scoping actually
  // uses) onto every staff account whose legacy department string
  // unambiguously matches one just-seeded department name. Run after
  // department creation, since it needs those rows to exist - this is
  // what makes prisma/seed.js's DHRA HR team accounts (all department:
  // 'HR') actually resolve to the real HR/DHRA department row rather
  // than sitting with departmentId left null.
  const staff = await prisma.staffUser.findMany();
  let backfilled = 0;
  for (const s of staff) {
    if (s.departmentId) continue; // already assigned, leave it alone
    const matches = await prisma.department.findMany({ where: { name: s.department, status: 'Approved' } });
    if (matches.length === 1) {
      await prisma.staffUser.update({ where: { id: s.id }, data: { departmentId: matches[0].id } });
      backfilled++;
    }
    // matches.length === 0 (no such department) or > 1 (ambiguous, e.g.
    // "CWG") is left unassigned deliberately - listForAdmin treats a
    // missing departmentId as "sees nothing", never "sees everything".
  }
  console.log(`\nBackfilled departmentId for ${backfilled} staff account(s) from an unambiguous department-name match.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
