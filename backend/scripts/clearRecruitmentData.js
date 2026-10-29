// Clears the recruitment data - every vacancy and everything that hangs off
// one: applications (drafts and submitted), their documents, shortlisting
// committees, interviews, EXCO approvals, offers, hires, bulk emails,
// advert evidence and vacancy drafts - together with the notices about
// them and the uploaded files only they used. For a fresh start after
// testing, e.g. before the pilot.
//
// Keeps the accounts: staff, and candidates with their profiles (education,
// work experience, certificates, exam grades, photo), internal candidates'
// employment details and HR's check of them, candidate tags, data requests.
// Keeps the organisation structure, settings, templates, delegations, the
// applicant survey answers and the logs (audit trail, activity, access).
// Ids are not reset, so nothing left in the logs points at a new record.
// Approved headcount: each hire is taken off its title's Filled count.
//
// --restart-job-refs also restarts the job reference numbers (UCAA/ADV/...
// and the onboarding case numbers) at 001 for the year. The audit trail
// still names the old references, so leave it off unless that is wanted.
//
// Irreversible. Without --yes it only says what it would delete.
//
//   node scripts/clearRecruitmentData.js [--restart-job-refs]          # what it would do
//   node scripts/clearRecruitmentData.js [--restart-job-refs] --yes    # do it
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');

// Children before parents, so no delete trips a foreign key.
const TABLES = [
  ['ShortlistDecision', 'shortlistDecision'], ['ShortlistRating', 'shortlistRating'],
  ['ShortlistAssignment', 'shortlistAssignment'], ['ShortlistMember', 'shortlistMember'], ['ShortlistExercise', 'shortlistExercise'],
  ['PanelMember', 'panelMember'], ['InterviewRound', 'interviewRound'],
  ['Hire', 'hire'], ['Offer', 'offer'], ['ApplicationDocument', 'applicationDocument'], ['Application', 'application'],
  ['ExcoShortlistApproval', 'excoShortlistApproval'], ['VacancyAdvertEvidence', 'vacancyAdvertEvidence'],
  ['BulkEmailRecipient', 'bulkEmailRecipient'], ['BulkEmail', 'bulkEmail'],
  ['VacancyDraft', 'vacancyDraft'], ['RequisitionSignedCopyChange', 'requisitionSignedCopyChange'], ['Vacancy', 'vacancy']
];

// Staff notices and SLA escalations not about a vacancy, application,
// interview or offer - these stay.
const KEEP_STAFF_NOTICES = ['DepartmentApproval', 'DirectorateApproval', 'PositionApproval', 'SystemHealthAlert',
  'DataErasureRequested', 'PendingApprovalsDigest', 'StaffGroupSyncFailed'];
// Candidate notices about their account rather than an application.
const KEEP_CANDIDATE_NOTICES = ['ProfileCompleted', 'DataRequestRefused', 'EmploymentVerified', 'EmploymentDiscrepancy'];

// Only names the app gives uploads (middleware/upload.js) are touched.
const UPLOAD_NAME_RE = /^(requisition-(signed-)?|appointment-signed-|advert-evidence-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]{1,8}$/;

function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

// A table a database not yet migrated lacks (P2021) is skipped, not fatal.
async function orSkip(work) {
  try {
    return await work();
  } catch (err) {
    if (err.code === 'P2021') return null;
    throw err;
  }
}

const baseName = (url) => (url ? path.basename(String(url).split('?')[0]) : null);

// The uploads the kept records still use: candidates' photos and internal
// candidates' managers' letters. Every other app-named upload belonged to
// a vacancy or an application.
async function uploadsToRemove() {
  const dir = uploadDir();
  if (!fs.existsSync(dir)) return [];
  const [photos, letters] = await Promise.all([
    prisma.candidate.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } }),
    prisma.internalProfile.findMany({ where: { supportingDocumentUrl: { not: null } }, select: { supportingDocumentUrl: true } })
  ]);
  const kept = new Set([...photos.map((p) => baseName(p.photoUrl)), ...letters.map((l) => baseName(l.supportingDocumentUrl))]);
  return fs.readdirSync(dir).filter((name) => UPLOAD_NAME_RE.test(name) && !kept.has(name));
}

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').replace(/\?.*$/, '');
  const confirmed = process.argv.includes('--yes');
  const restartJobRefs = process.argv.includes('--restart-job-refs');

  const staffNotices = { taskType: { notIn: KEEP_STAFF_NOTICES } };
  const candidateNotices = { type: { notIn: KEEP_CANDIDATE_NOTICES } };
  const [counts, notices, escalations, candidateNoticeCount, candidates, hires, files] = await Promise.all([
    Promise.all(TABLES.map(([, delegate]) => orSkip(() => prisma[delegate].count()))),
    prisma.notification.count({ where: staffNotices }),
    prisma.taskEscalation.count({ where: staffNotices }),
    prisma.candidateNotification.count({ where: candidateNotices }),
    prisma.candidate.count(),
    prisma.hire.findMany({ where: { positionId: { not: null } }, select: { positionId: true } }),
    uploadsToRemove()
  ]);
  const submitted = await prisma.application.count({ where: { status: { not: 'Draft' } } });

  console.log(`Database:      ${host}`);
  console.log(`Upload folder: ${uploadDir()}`);
  console.log('\nWould delete:');
  TABLES.forEach(([table], i) => console.log(`  ${table.padEnd(26)} ${counts[i] ?? '(no such table)'}${table === 'Application' ? ` (${submitted} submitted)` : ''}`));
  console.log(`  ${'Notification (staff)'.padEnd(26)} ${notices}`);
  console.log(`  ${'TaskEscalation'.padEnd(26)} ${escalations}`);
  console.log(`  ${'CandidateNotification'.padEnd(26)} ${candidateNoticeCount}`);
  console.log(`  ${'Uploaded files'.padEnd(26)} ${files.length}`);
  if (hires.length) console.log(`  and take ${hires.length} hire(s) off their titles' Filled counts`);
  if (restartJobRefs) console.log('  and restart job reference numbers at 001');
  console.log(`\nKeeps ${candidates} candidate account(s) with their profiles, every staff account, the organisation,`);
  console.log('settings, templates, applicant survey answers and the logs.');

  if (!confirmed) {
    console.error('\nNothing has been changed. Re-run with --yes to proceed.');
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }
  console.log('\nClearing ...');

  await prisma.$transaction(async (tx) => {
    for (const { positionId } of hires) {
      await tx.position.updateMany({ where: { id: positionId, occupied: { gt: 0 } }, data: { occupied: { decrement: 1 } } });
    }
    // The self-reference that would otherwise block deleting vacancies.
    await tx.vacancy.updateMany({ data: { readvertisedFromId: null } });
    for (const [table, delegate] of TABLES.filter((t, i) => counts[i] !== null)) {
      const { count } = await tx[delegate].deleteMany({});
      console.log(`  ${table.padEnd(26)} ${count} deleted`);
    }
    const n = await tx.notification.deleteMany({ where: staffNotices });
    const e = await tx.taskEscalation.deleteMany({ where: staffNotices });
    const c = await tx.candidateNotification.deleteMany({ where: candidateNotices });
    console.log(`  ${'Notification (staff)'.padEnd(26)} ${n.count} deleted`);
    console.log(`  ${'TaskEscalation'.padEnd(26)} ${e.count} deleted`);
    console.log(`  ${'CandidateNotification'.padEnd(26)} ${c.count} deleted`);
    if (restartJobRefs) {
      const { count } = await tx.jobRefSequence.deleteMany({});
      console.log(`  ${'JobRefSequence'.padEnd(26)} ${count} deleted`);
    }
  }, { timeout: 300000, maxWait: 10000 });

  let removed = 0;
  for (const name of files) {
    try {
      fs.rmSync(path.join(uploadDir(), name), { force: true });
      removed++;
    } catch (err) {
      console.warn(`  could not delete ${name}: ${err.message}`);
    }
  }
  console.log(`\nDeleted ${removed} uploaded file(s).`);
  console.log(`Done. ${await prisma.candidate.count()} candidate account(s) and ${await prisma.staffUser.count()} staff account(s) kept.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\nCLEAR FAILED:', e);
  process.exitCode = 1;
  await prisma.$disconnect();
});
