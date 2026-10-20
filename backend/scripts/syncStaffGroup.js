// One-off (and safe to run again): brings the staff app's Entra group
// (ENTRA_STAFF_GROUP_ID) in line with the staff accounts here, for accounts
// made before the group was managed from e-Recruitment
// (services/staffGroupService.js): every active account in the group, every
// deactivated one out of it.
//
//   node scripts/syncStaffGroup.js          what it would change (nothing is written)
//   node scripts/syncStaffGroup.js --yes    apply it
//
// Group members with no staff account are listed but left alone - they are
// the "Waiting for a role" people, or put there by the Entra administrator.
require('dotenv').config();
const prisma = require('../src/config/db');
const directory = require('../src/services/directoryService');
const staffGroup = require('../src/services/staffGroupService');

async function run({ apply = false, log = console.log } = {}) {
  if (!staffGroup.isConfigured()) {
    log('The staff app group is not set up here: ENTRA_STAFF_GROUP_ID and the directory app settings (SETUP.md) are needed.');
    return { configured: false };
  }
  const members = await directory.groupMemberIds(staffGroup.groupId());
  const accounts = await prisma.staffUser.findMany({ orderBy: { name: 'asc' } });
  const plan = { add: [], remove: [], notFound: [], inLine: [] };
  const accountIds = new Set();

  for (const staff of accounts) {
    const userId = staff.entraObjectId || await directory.findUserIdByEmail(staff.email);
    if (!userId) { plan.notFound.push(staff); continue; }
    accountIds.add(userId);
    if (staff.active && !members.has(userId)) plan.add.push(staff);
    else if (!staff.active && members.has(userId)) plan.remove.push(staff);
    else plan.inLine.push(staff);
  }
  const strangers = [...members].filter((id) => !accountIds.has(id));

  const line = (s) => `  ${s.name} <${s.email}>`;
  log(`To add (active, not in the group): ${plan.add.length}`); plan.add.forEach((s) => log(line(s)));
  log(`To remove (deactivated, still in the group): ${plan.remove.length}`); plan.remove.forEach((s) => log(line(s)));
  log(`Not found in the UCAA directory: ${plan.notFound.length}`); plan.notFound.forEach((s) => log(line(s)));
  log(`Already right: ${plan.inLine.length}`);
  log(`Group members with no staff account (left alone): ${strangers.length}`);

  if (!apply) {
    if (plan.add.length || plan.remove.length) log('Run again with --yes to apply.');
    return { configured: true, plan, strangers };
  }

  let failed = 0;
  for (const staff of [...plan.add, ...plan.remove]) {
    const result = await staffGroup.sync(staff);
    if (result.state === 'Failed') { failed += 1; log(`  Failed: ${staff.email} - ${result.error}`); }
  }
  // Record where the accounts already in line stand, so Staff accounts shows it.
  for (const staff of plan.inLine) {
    const state = staff.active ? 'InGroup' : 'NotInGroup';
    if (staff.entraGroupState !== state) {
      await prisma.staffUser.update({ where: { id: staff.id }, data: { entraGroupState: state, entraGroupError: null, entraGroupCheckedAt: new Date() } });
    }
  }
  log(`Done: ${plan.add.length + plan.remove.length - failed} changed, ${failed} failed (shown on Staff accounts with Retry).`);
  return { configured: true, plan, strangers, failed };
}

module.exports = { run };

if (require.main === module) {
  run({ apply: process.argv.includes('--yes') })
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
