const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// DEVELOPMENT DATA ONLY. Real staff sign in with their UCAA Microsoft
// account and have no password; these demo accounts get one so they can be
// used on a machine with no Entra tenant, through the password sign-in that
// only works while DEV_PASSWORD_LOGIN=true and NODE_ENV isn't production
// (staffAuthController.login). In production, create the first system
// administrator with scripts/createSystemAdmin.js instead of running this.
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('prisma/seed.js creates demo accounts with a known password - not in production. Use scripts/createSystemAdmin.js.');
    process.exit(1);
  }
  const password = await bcrypt.hash('ChangeMe123!', 10);

  // The DHRA HR team (department 'HR' for every one of them), plus an
  // accounts-only system administrator. departmentId (the FK actually used
  // for admin vacancy scoping) is backfilled onto these accounts by
  // scripts/seedDepartments.js, once the real Department rows exist.
  const staff = [
    { name: 'Alice HR', email: 'hro@caa.co.ug', role: 'HR_Officer', department: 'HR' },
    { name: 'Sam Senior', email: 'shro@caa.co.ug', role: 'Senior_HR_Officer', department: 'HR' },
    { name: 'Brian Principal', email: 'phro@caa.co.ug', role: 'Principal_HR_Officer', department: 'HR' },
    { name: 'Mary Manager', email: 'manager@caa.co.ug', role: 'Manager', department: 'HR' },
    { name: 'Carol Director', email: 'dhra@caa.co.ug', role: 'Director', department: 'HR' },
    { name: 'Ivan Admin', email: 'admin@caa.co.ug', role: null, isSystemAdmin: true, department: 'ICT' }
  ];

  for (const s of staff) {
    await prisma.staffUser.upsert({
      where: { email: s.email },
      update: {},
      create: { ...s, passwordHash: password }
    });
  }

  console.log('Seeded demo staff accounts (password for all: ChangeMe123!, with DEV_PASSWORD_LOGIN=true):');
  staff.forEach(s => console.log(`  ${(s.role || 'System admin').padEnd(22)} ${s.email}`));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
