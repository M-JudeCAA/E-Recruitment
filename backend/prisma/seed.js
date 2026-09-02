const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('ChangeMe123!', 10);

  const staff = [
    { name: 'Alice HR', email: 'hro@caa.co.ug', role: 'HR_Officer', department: 'AVSEC' },
    { name: 'Brian Principal', email: 'phro@caa.co.ug', role: 'Principal_HR_Officer', department: 'AVSEC' },
    { name: 'Carol Director', email: 'dhra@caa.co.ug', role: 'DHRA_Manager_HR', department: 'HRM' }
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
