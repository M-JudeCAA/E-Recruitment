// Empties the database of everything except the staff accounts (StaffUser)
// and the SLA policy table (configuration, not data), deletes the uploaded
// files that belonged to it, then re-seeds the directorate/department list
// (scripts/seedDepartments.js) so the org structure exists again. Job
// references start again from 001.
//
// Leave it there for a clean start (no positions are seeded - add them
// before the first vacancy, since a requisition is matched to the
// organogram), or run scripts/seedFullWorkflowDemoData.js afterwards to
// repopulate vacancies, candidates and the selection workflow.
//
// --remove-demo-staff also deletes the demo staff accounts prisma/seed.js
// creates (scripts/lib/demoStaff.js), so only real people's accounts remain.
// It refuses unless another active system administrator exists - otherwise
// nobody could create staff accounts afterwards (scripts/createSystemAdmin.js
// makes one).
//
// Irreversible - it deletes every vacancy, candidate, application, interview,
// offer, notification and audit row. Without --yes it only says what it
// would delete.
//
//   node scripts/resetDemoData.js [--remove-demo-staff]          # what it would do
//   node scripts/resetDemoData.js [--remove-demo-staff] --yes    # do it
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const prisma = require('../src/config/db');
const { DEMO_STAFF } = require('./lib/demoStaff');

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
  'Notification', 'TaskEscalation', 'AuditLog', 'SystemHealth', 'DataAccessLog',
  'VacancyDraft', 'Vacancy', 'JobRefSequence', 'Position', 'Department', 'OrgImport', 'Directorate'
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
  DataAccessLog: 'dataAccessLog', VacancyDraft: 'vacancyDraft', JobRefSequence: 'jobRefSequence',
  Vacancy: 'vacancy', Position: 'position', Department: 'department', OrgImport: 'orgImport', Directorate: 'directorate'
};

// Keyed by something other than an auto-increment id.
const NO_ID_COUNTER = ['SystemHealth', 'JobRefSequence'];

// Every upload belongs to a candidate, application or vacancy (CVs,
// documents, photos, requisitions) - never to a staff account - so none
// survives the reset. Only names the app gives uploads (middleware/upload.js:
// <uuid>.<ext> or requisition-<uuid>.<ext>) are touched, so a misconfigured
// UPLOAD_DIR never loses anything else.
const UPLOAD_NAME_RE = /^(requisition-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,8}$/;

function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

function uploadedFiles() {
  const dir = uploadDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => UPLOAD_NAME_RE.test(name));
}

const DEMO_EMAILS = DEMO_STAFF.map((s) => s.email);

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').replace(/\?.*$/, '');
  const confirmed = process.argv.includes('--yes');
  const removeDemoStaff = process.argv.includes('--remove-demo-staff');

  const demoStaff = removeDemoStaff
    ? await prisma.staffUser.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { email: true } })
    : [];
  const otherAdmins = removeDemoStaff
    ? await prisma.staffUser.count({ where: { isSystemAdmin: true, active: true, email: { notIn: DEMO_EMAILS } } })
    : null;
  const files = uploadedFiles();

  console.log(`Database:      ${host}`);
  console.log(`Upload folder: ${uploadDir()} (${files.length} uploaded file(s))`);
  console.log('Deletes every vacancy, candidate, application, interview, offer, notification and audit row,');
  console.log('and the uploaded files. Keeps the staff accounts and SLA policies.');
  if (removeDemoStaff) {
    console.log(`Also deletes the demo staff accounts: ${demoStaff.map((s) => s.email).join(', ') || '(none found)'}`);
  }
  if (removeDemoStaff && otherAdmins === 0) {
    console.error('\nRefusing: no active system administrator would be left to create staff accounts.');
    console.error('Create one first:  node scripts/createSystemAdmin.js --email <their UCAA address> --name "<Full name>"');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  if (!confirmed) {
    console.error('\nNothing has been changed. Re-run with --yes to proceed.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  console.log('\nResetting ...');

  // Self- and staff-references that would otherwise block the deletes below.
  await prisma.vacancy.updateMany({ data: { readvertisedFromId: null } });
  await prisma.staffUser.updateMany({ data: { departmentId: null, actingAsId: null } });

  for (const table of TABLES) {
    const { count } = await prisma[DELEGATE[table]].deleteMany({});
    console.log(`  ${table.padEnd(30)} ${count} deleted`);
    // Fresh ids from 1. InnoDB resets to max(id)+1, i.e. 1 on an empty table.
    if (!NO_ID_COUNTER.includes(table)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`).catch((err) => {
        console.warn(`    (could not reset the id counter on ${table}: ${err.message})`);
      });
    }
  }

  if (removeDemoStaff) {
    // Nothing points at them any more - every table that did is empty now.
    const { count } = await prisma.staffUser.deleteMany({ where: { email: { in: DEMO_EMAILS } } });
    console.log(`  ${'StaffUser (demo accounts)'.padEnd(30)} ${count} deleted`);
  }

  let removed = 0;
  for (const name of files) {
    fs.rmSync(path.join(uploadDir(), name), { force: true });
    removed++;
  }
  console.log(`\nDeleted ${removed} uploaded file(s).`);

  const staff = await prisma.staffUser.findMany({ select: { email: true, role: true, isSystemAdmin: true } });
  console.log(`Kept ${staff.length} staff account(s) and ${await prisma.slaPolicy.count()} SLA polic(ies):`);
  staff.forEach((s) => console.log(`  ${(s.role || (s.isSystemAdmin ? 'System admin' : 'no role')).padEnd(22)} ${s.email}`));
  await prisma.$disconnect();

  console.log('\nRe-seeding directorates and departments ...');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'seedDepartments.js')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('seedDepartments.js failed');
  console.log('\nDone - a clean start. Before the first vacancy, add positions to the departments (Departments');
  console.log('screen): a requisition is matched to the organogram, and none are seeded.');
  console.log('For demo data instead: node scripts/seedFullWorkflowDemoData.js');
}

main().catch(async (e) => {
  console.error('\nRESET FAILED:', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
