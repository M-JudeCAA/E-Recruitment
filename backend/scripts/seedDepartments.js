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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
