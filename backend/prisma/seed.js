const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('ChangeMe123!', 10);

  // All five are the DHRA HR team (the only staff who hold logins on this
  // system, per the master spec's Part 2) - department is 'HR' for every
  // one of them, not scattered across departments they merely happen to
  // be recruiting for. departmentId (the FK actually used for admin
  // vacancy scoping) is backfilled onto these accounts by
  // scripts/seedDepartments.js, once the real Department rows exist.
  const staff = [
    { name: 'Alice HR', email: 'hro@caa.co.ug', role: 'HR_Officer', department: 'HR' },
    { name: 'Sam Senior', email: 'shro@caa.co.ug', role: 'Senior_HR_Officer', department: 'HR' },
    { name: 'Brian Principal', email: 'phro@caa.co.ug', role: 'Principal_HR_Officer', department: 'HR' },
    { name: 'Mary Manager', email: 'manager@caa.co.ug', role: 'Manager', department: 'HR' },
    { name: 'Carol Director', email: 'dhra@caa.co.ug', role: 'Director', department: 'HR' }
  ];

  for (const s of staff) {
    await prisma.staffUser.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, passwordHash: password }
    });
  }

  console.log('Seeded staff accounts (password for all: ChangeMe123!):');
  staff.forEach(s => console.log(`  ${s.role.padEnd(22)} ${s.email}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
