const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { DEMO_STAFF } = require('../scripts/lib/demoStaff');

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

  // The DHRA HR team plus an accounts-only system administrator
  // (scripts/lib/demoStaff.js). departmentId (the FK actually used for admin
  // vacancy scoping) is backfilled onto these accounts by
  // scripts/seedDepartments.js, once the real Department rows exist.
  const staff = DEMO_STAFF;

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
