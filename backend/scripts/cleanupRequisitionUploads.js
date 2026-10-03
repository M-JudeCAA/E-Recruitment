// Run on a schedule (the scheduler worker, or cron), not as an in-process
// timer inside the API - same convention as scripts/checkSlaEscalations.js.
// 0 * * * * cd /path/to/backend && node scripts/cleanupRequisitionUploads.js
//
// Every requisition HR uploads on the New Listing page is stored straight
// away (requisition-<uuid>.pdf|docx, see services/requisitionService.js) so
// it can be read and reviewed - but plenty are never used: the wrong file,
// a replaced document, a draft deleted or a listing abandoned. This removes
// any requisition upload that no vacancy and no saved draft refers to, once
// it is old enough that nobody can still be in the middle of using it.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');

// Long enough for anyone to finish (or auto-save) the listing they were
// writing when they uploaded it.
const GRACE_MS = 24 * 60 * 60 * 1000;
const REQUISITION_FILE_RE = /^requisition-[0-9a-f-]{36}\.(pdf|docx)$/;

function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

async function referencedFilenames() {
  const [vacancies, drafts] = await Promise.all([
    prisma.vacancy.findMany({ where: { requisitionDocumentUrl: { not: null } }, select: { requisitionDocumentUrl: true } }),
    prisma.vacancyDraft.findMany({ where: { requisitionFilename: { not: null } }, select: { requisitionFilename: true } })
  ]);
  return new Set([
    ...vacancies.map((v) => path.basename(v.requisitionDocumentUrl)),
    ...drafts.map((d) => d.requisitionFilename)
  ]);
}

async function run(now = new Date()) {
  const dir = uploadDir();
  if (!fs.existsSync(dir)) return 'Requisition upload cleanup complete. No upload folder yet.';

  const candidates = fs.readdirSync(dir).filter((name) => REQUISITION_FILE_RE.test(name));
  const referenced = await referencedFilenames();
  let removed = 0;
  let kept = 0;
  for (const name of candidates) {
    if (referenced.has(name)) { kept++; continue; }
    const filePath = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (err) {
      continue; // removed by someone else meanwhile
    }
    if (now.getTime() - stat.mtimeMs < GRACE_MS) { kept++; continue; }
    fs.rmSync(filePath, { force: true });
    removed++;
  }
  return `Requisition upload cleanup complete. ${removed} unused upload(s) removed, ${kept} kept.`;
}

module.exports = { run, GRACE_MS };

if (require.main === module) {
  require('../src/utils/jobRunner').runAsScript('cleanupRequisitionUploads', run);
}
