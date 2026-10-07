// Seeds the six real Directorates and UCAA's departments, from HR's list of
// departments by directorate - 28 departments, plus the offices that recruit
// in their own right (the Director General's Office, each Director's Office,
// Corporate Affairs and the General Manager's Office). All pre-approved,
// since every one of these is in use, not a proposal awaiting review.
//
// Re-running it is safe: rows are matched by code within their directorate,
// a missing one is created and an existing one gets the full name below.
// Departments not in this list are left alone and listed at the end;
// `--prune` deletes those that nothing uses (no positions, vacancies or staff).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PRUNE = process.argv.includes('--prune');

// [code, full name]
const DIRECTORATES = [
  ['DHRA', 'Human Resource and Administration'], ['DANS', 'Air Navigation Services'], ['DAAS', 'Airports and Aviation Security'],
  ['DSSER', 'Safety, Security and Economic Regulation'], ['DF', 'Finance'], ['CORP', 'Corporate']
];

// [department code, full name, directorate code]
const DEPARTMENTS = [
  ['IT', 'Information Technology', 'CORP'],
  ['AUDIT', 'Internal Audit and Risk Management', 'CORP'],
  ['LEGAL', 'Legal', 'CORP'],
  ['MCCS', 'Marketing, Commercial and Customer Service', 'CORP'],
  ['PDU', 'Procurement', 'CORP'],
  ['PA', 'Public Affairs', 'CORP'],
  ['QA', 'Quality Assurance / Risk Management', 'CORP'],
  ['SP', 'Strategic Planning', 'CORP'],
  ['AEPD', 'Aerodrome Engineering, Planning and Development', 'DAAS'],
  ['AM', 'Aerodrome Maintenance', 'DAAS'],
  ['AVSEC', 'Aviation Security', 'DAAS'],
  ['OPS EIA', 'Operations EIA', 'DAAS'],
  ['RA', 'Regional Airports', 'DAAS'],
  ['SMS', 'Safety Management System', 'DAAS'],
  ['AIM', 'Aeronautical Information Management', 'DANS'],
  ['ATS', 'Air Traffic Services', 'DANS'],
  ['CNS', 'Communication, Navigation and Surveillance', 'DANS'],
  ['TTSQA', 'Technical Training / SMS / Quality Assurance', 'DANS'],
  ['ACCOUNTS', 'Accounting', 'DF'],
  ['FINANCE', 'Finance', 'DF'],
  ['MGT ACCT', 'Management Accounts', 'DF'],
  ['ADMIN', 'Administration, Estates and Transport', 'DHRA'],
  ['HR', 'Human Resource', 'DHRA'],
  ['LD', 'Human Resource Learning and Development', 'DHRA'],
  ['ANSAS', 'Air Navigation Services and Aerodrome Standards', 'DSSER'],
  ['ASFAL', 'Aviation Security Facilitation Policy and Regulation', 'DSSER'],
  ['ER', 'Economic Regulation', 'DSSER'],
  ['FSS', 'Flight Safety Standards', 'DSSER'],
  // Offices that have recruitments of their own.
  ['DG OFFICE', "Director General's Office", 'CORP'],
  ['CORP AFFAIRS', 'Corporate Affairs', 'CORP'],
  ['DIR OFFICE', "Director's Office - HRA", 'DHRA'],
  ['DIR OFFICE', "Director's Office - ANS", 'DANS'],
  ['DIR OFFICE', "Director's Office - AAS", 'DAAS'],
  ['DIR OFFICE', "Director's Office - SSER", 'DSSER'],
  ['DIR OFFICE', "Director's Office - F", 'DF'],
  ['GM OFFICE', "General Manager's Office", 'DAAS']
];

async function main() {
  // Recorded as creator/approver of the seeded rows: a Director if there is
  // one, else a system administrator (a fresh database after
  // resetDemoData.js --remove-demo-staff may have only that), else anyone.
  const systemUser = await prisma.staffUser.findFirst({ where: { role: 'Director', active: true } })
    || await prisma.staffUser.findFirst({ where: { isSystemAdmin: true, active: true } })
    || await prisma.staffUser.findFirst();
  if (!systemUser) {
    throw new Error('Create a staff account first (scripts/createSystemAdmin.js) - departments need a createdById.');
  }

  const directorateByCode = {};
  for (const [code, name] of DIRECTORATES) {
    directorateByCode[code] = await prisma.directorate.upsert({
      where: { code },
      update: { name },
      create: { code, name, createdById: systemUser.id }
    });
  }
  console.log(`Seeded ${DIRECTORATES.length} directorates.`);

  const seededIds = new Set();
  for (const [code, name, directorateCode] of DEPARTMENTS) {
    const directorate = directorateByCode[directorateCode];
    const row = await prisma.department.upsert({
      where: { code_directorateId: { code, directorateId: directorate.id } },
      update: { name },
      create: {
        code,
        name,
        directorateId: directorate.id,
        status: 'Approved',
        createdById: systemUser.id,
        approvedById: systemUser.id,
        approvedAt: new Date()
      }
    });
    seededIds.add(row.id);
  }
  console.log(`Seeded ${DEPARTMENTS.length} departments and offices.`);

  // Departments from before this list (e.g. the old "CWG" rows).
  const others = await prisma.department.findMany({
    where: { id: { notIn: [...seededIds] } },
    include: { directorate: true, _count: { select: { positions: true, vacancies: true, staff: true } } }
  });
  if (others.length) {
    console.log(`\n${others.length} department(s) not in the list:`);
    for (const d of others) {
      const inUse = d._count.positions + d._count.vacancies + d._count.staff > 0;
      if (PRUNE && !inUse) {
        await prisma.department.delete({ where: { id: d.id } });
        console.log(`  deleted   ${d.code} (${d.directorate.code}) - ${d.name}`);
      } else {
        const use = `${d._count.positions} positions, ${d._count.vacancies} vacancies, ${d._count.staff} staff`;
        console.log(`  kept      ${d.code} (${d.directorate.code}) - ${d.name}${inUse ? ` [in use: ${use}]` : ''}`);
      }
    }
    if (!PRUNE) console.log('Re-run with --prune to delete the ones nothing uses; move or delete the rest on the Departments page.');
  }

  console.log('\nNo Position rows are seeded - add them on the Positions page or by import.');

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
    const matches = await prisma.department.findMany({ where: { OR: [{ code: s.department }, { name: s.department }], status: 'Approved' } });
    if (matches.length === 1) {
      await prisma.staffUser.update({ where: { id: s.id }, data: { departmentId: matches[0].id } });
      backfilled++;
    }
    // matches.length === 0 (no such department) or > 1 (ambiguous, e.g.
    // "DIR OFFICE") is left unassigned deliberately - listForAdmin treats a
    // missing departmentId as "sees nothing", never "sees everything".
  }
  console.log(`\nBackfilled departmentId for ${backfilled} staff account(s) from an unambiguous department-name match.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
