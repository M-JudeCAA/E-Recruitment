// Empties the database of everything except the staff accounts (StaffUser)
// and the SLA policy table (configuration, not data), then re-seeds the
// directorate/department list (scripts/seedDepartments.js) so the org
// structure exists again. Run scripts/seedFullWorkflowDemoData.js afterwards
// to repopulate vacancies, candidates and the selection workflow.
//
// Irreversible - it deletes every vacancy, candidate, application, interview,
// offer, notification and audit row. Refuses to run without --yes, and prints
// the database host it is about to wipe first.
//
//   node scripts/resetDemoData.js --yes
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');
const prisma = require('../src/config/db');

// Children before parents, so no delete trips a foreign key. StaffUser and
// SlaPolicy are deliberately absent.
const TABLES = [
  'DelegationUsage', 'Delegation',
  'ShortlistDecision', 'ShortlistRating', 'ShortlistAssignment', 'ShortlistMember', 'ShortlistExercise',
  'PanelDayLink', 'InterviewDay',
  'PanelAccessToken', 'PanelMember', 'InterviewRound',
  'Offer', 'ApplicationDocument', 'Application',
  'CandidateNotification', 'VerificationToken', 'PendingCandidateRegistration',
  'InternalProfile', 'WorkExperience', 'Education', 'ExamGrade', 'Certificate', 'Candidate',
  'Notification', 'TaskEscalation', 'AuditLog', 'SystemHealth',
  'Vacancy', 'Position', 'Department', 'Directorate'
];

const DELEGATE = {
  DelegationUsage: 'delegationUsage', Delegation: 'delegation',
  ShortlistDecision: 'shortlistDecision', ShortlistRating: 'shortlistRating', ShortlistAssignment: 'shortlistAssignment',
  ShortlistMember: 'shortlistMember', ShortlistExercise: 'shortlistExercise', PanelDayLink: 'panelDayLink', InterviewDay: 'interviewDay',
  ApplicationDocument: 'applicationDocument',
  PanelAccessToken: 'panelAccessToken', PanelMember: 'panelMember', InterviewRound: 'interviewRound',
  Offer: 'offer', Application: 'application',
  CandidateNotification: 'candidateNotification', VerificationToken: 'verificationToken',
  PendingCandidateRegistration: 'pendingCandidateRegistration',
  InternalProfile: 'internalProfile', WorkExperience: 'workExperience', Education: 'education',
  ExamGrade: 'examGrade', Certificate: 'certificate', Candidate: 'candidate',
  Notification: 'notification', TaskEscalation: 'taskEscalation', AuditLog: 'auditLog', SystemHealth: 'systemHealth',
  Vacancy: 'vacancy', Position: 'position', Department: 'department', Directorate: 'directorate'
};

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').replace(/\?.*$/, '');
  if (!process.argv.includes('--yes')) {
    console.error(`This deletes every vacancy, candidate, application, interview, offer and notification in\n  ${host}\nkeeping only the staff accounts and SLA policies. Re-run with --yes to proceed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Resetting ${host} ...`);

  // Self- and staff-references that would otherwise block the deletes below.
  await prisma.vacancy.updateMany({ data: { readvertisedFromId: null } });
  await prisma.staffUser.updateMany({ data: { departmentId: null, actingAsId: null } });

  for (const table of TABLES) {
    const { count } = await prisma[DELEGATE[table]].deleteMany({});
    console.log(`  ${table.padEnd(30)} ${count} deleted`);
    // Fresh ids from 1, so the seeded data reads cleanly. InnoDB resets to
    // max(id)+1, i.e. 1 on an empty table. SystemHealth has a string key.
    if (table !== 'SystemHealth') {
      await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`).catch((err) => {
        console.warn(`    (could not reset the id counter on ${table}: ${err.message})`);
      });
    }
  }

  const staff = await prisma.staffUser.count();
  console.log(`\nKept ${staff} staff account(s) and ${await prisma.slaPolicy.count()} SLA polic(ies).`);
  await prisma.$disconnect();

  console.log('\nRe-seeding directorates and departments ...');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'seedDepartments.js')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('seedDepartments.js failed');
  console.log('\nDone. Next: node scripts/seedFullWorkflowDemoData.js');
}

main().catch(async (e) => {
  console.error('\nRESET FAILED:', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
