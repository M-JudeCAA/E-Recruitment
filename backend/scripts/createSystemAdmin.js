// Creates (or promotes) the system administrator - the account that manages
// every other staff account. Run on the server, since nobody can do it
// through the app until the first administrator exists:
//
//   node scripts/createSystemAdmin.js --email it.admin@caa.co.ug --name "IT Admin" [--department ICT] [--break-glass]
//
// They sign in like all staff, with their UCAA Microsoft account. With
// --break-glass the account also gets a password, printed once here, for
// the emergency sign-in that only works while BREAK_GLASS_LOGIN=true on
// the server (for when Microsoft sign-in is unavailable). Keep it sealed
// and turn BREAK_GLASS_LOGIN off again afterwards.
//
// The account gets no HR role: administrators manage accounts, not
// recruitment. Give it one later from the Staff accounts screen, by another
// administrator, if the person also works in HR.
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../src/config/db');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const email = (arg('email') || '').trim().toLowerCase();
  const name = (arg('name') || '').trim();
  const department = (arg('department') || 'ICT').trim();
  const breakGlass = process.argv.includes('--break-glass');
  if (!email || !name) {
    console.error('Usage: node scripts/createSystemAdmin.js --email <ucaa email> --name "<full name>" [--department ICT] [--break-glass]');
    process.exit(1);
  }
  const domains = (process.env.INTERNAL_EMAIL_DOMAIN || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!domains.includes(email.split('@')[1])) {
    console.error(`${email} is not on the internal email domain (INTERNAL_EMAIL_DOMAIN=${process.env.INTERNAL_EMAIL_DOMAIN || ''}) - it must be the UCAA Microsoft account they sign in with.`);
    process.exit(1);
  }

  let password;
  const data = { name, isSystemAdmin: true, active: true };
  if (breakGlass) {
    password = crypto.randomBytes(18).toString('base64url');
    data.passwordHash = await bcrypt.hash(password, 12);
  }

  const existing = await prisma.staffUser.findUnique({ where: { email } });
  const staff = existing
    ? await prisma.staffUser.update({ where: { id: existing.id }, data })
    : await prisma.staffUser.create({ data: { ...data, email, department, role: null } });

  await prisma.auditLog.create({
    data: {
      entityType: 'StaffUser', entityId: staff.id, action: existing ? 'MadeSystemAdmin' : 'Created',
      payload: { via: 'scripts/createSystemAdmin.js', breakGlassPasswordSet: breakGlass }
    }
  });

  console.log(`${existing ? 'Promoted' : 'Created'} system administrator #${staff.id}: ${staff.name} <${staff.email}>`);
  console.log('They sign in at the staff portal with their UCAA Microsoft account.');
  if (password) {
    console.log('\nBreak-glass password (shown once - store it sealed):');
    console.log(`  ${password}`);
    console.log('It only works while BREAK_GLASS_LOGIN=true on the server.');
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
