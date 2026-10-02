const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');
const departmentModel = require('../models/departmentModel');
const positionModel = require('../models/positionModel');
const { extractDocumentText, PDF_MIME, DOCX_MIME } = require('../utils/documentText');
const { parseRequisitionText, normalizeLabel } = require('../utils/requisitionParser');
const { AppError } = require('../utils/errorResponse');
const { escapeHtml } = require('../utils/interviewFormat');

// A vacancy is created only from an EXCO-approved, signed requisition that
// HR uploads (there is no requisition workflow inside this system - the
// approval happens at EXCO, on paper or digitally, before HR gets here).
//
//   1. POST /api/vacancies/requisition stores the document (PDF or .docx
//      with a text layer - scans are refused), reads the job details out of
//      it, matches them to the organogram, and hands back a pre-filled
//      vacancy form with a confidence for every field (read()).
//   2. HR reviews and corrects the form, confirms the EXCO approval, adds
//      the screening criteria by hand as before, and creates the vacancy.
//      create() re-reads the stored document itself (forCreate()) - never
//      trusting what the browser sends back as "what the document said" -
//      and keeps the document, its hash and the snapshot of what was read
//      on the Vacancy row (requisition* columns).
//
// The same document can't back two vacancies (matched by content hash), so
// one approval can't be used to open a position twice (FR-ATS-004). A
// readvertisement carries its original's requisition over instead.

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
const FILENAME_RE = /^requisition-[0-9a-f-]{36}\.(pdf|docx)$/;
const MIME_FOR_EXT = { pdf: PDF_MIME, docx: DOCX_MIME };
const MAX_NAME_LENGTH = 191;

function storedPath(filename) {
  if (!FILENAME_RE.test(filename || '')) throw new AppError('That requisition upload is not valid - upload the document again.', 400);
  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir + path.sep) || !fs.existsSync(filePath)) {
    throw new AppError('The uploaded requisition could not be found - upload the document again.', 404);
  }
  return filePath;
}

function hashOf(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Organogram matching: the parsed department, job title and "reports to"
// against approved departments and their positions. Exact (ignoring case
// and punctuation) is high confidence; one name containing the other
// ("Human Resources Department" / "Human Resources") is medium; anything
// ambiguous is left for HR to pick.
function nameScore(candidate, wanted) {
  const a = normalizeLabel(candidate);
  const b = normalizeLabel(wanted);
  if (!a || !b) return 0;
  if (a === b) return 2;
  const pad = (s) => ` ${s} `;
  if (pad(a).includes(pad(b)) || pad(b).includes(pad(a))) return 1;
  return 0;
}

function bestMatch(options, wanted, label) {
  if (!wanted) return { match: null };
  const scored = options.map((o) => ({ o, score: nameScore(o.name, wanted) })).filter((s) => s.score > 0);
  if (!scored.length) return { match: null, warning: `${label} "${wanted}" is not on the organogram - pick it from the list.` };
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  if (best.length > 1) return { match: null, ambiguous: best.map((s) => s.o), warning: `${label} "${wanted}" matches more than one entry on the organogram - pick the right one.` };
  return { match: best[0].o, confidence: top === 2 ? 'high' : 'medium' };
}

async function matchOrganogram(fields) {
  const warnings = [];
  const result = { department: null, position: null, reportsTo: null };

  const departments = await departmentModel.findApproved();
  let deptCandidates = departments;
  // The same department name recurs under different directorates - narrow
  // by the directorate when the document names one.
  if (fields.directorate?.value) {
    const inDirectorate = departments.filter((d) => nameScore(d.directorate?.name || '', fields.directorate.value) > 0);
    if (inDirectorate.length) deptCandidates = inDirectorate;
  }
  const dept = bestMatch(deptCandidates, fields.department?.value, 'Department');
  if (dept.warning) warnings.push(dept.warning);
  if (!dept.match) return { ...result, warnings };
  result.department = { id: dept.match.id, name: dept.match.name, directorate: dept.match.directorate?.name || null, confidence: dept.confidence };

  const positions = await positionModel.findByDepartment(dept.match.id);
  const pos = bestMatch(positions, fields.jobTitle?.value, 'Job title');
  if (pos.warning) warnings.push(pos.warning);
  if (!pos.match) return { ...result, warnings };
  result.position = { id: pos.match.id, name: pos.match.name, confidence: pos.confidence };

  if (fields.reportsTo?.value) {
    const seniors = positions.filter((p) => p.level > pos.match.level);
    const rep = bestMatch(seniors, fields.reportsTo.value, 'Reports to');
    if (rep.warning) warnings.push(rep.warning);
    if (rep.match) result.reportsTo = { id: rep.match.id, name: rep.match.name, confidence: rep.confidence };
  }
  return { ...result, warnings };
}

// Job purpose, principal accountabilities and duties as one block of
// advert HTML - the same shape HR used to paste into the Job purpose field.
function jobPurposeHtml(fields) {
  const parts = [];
  for (const p of fields.jobPurpose?.value || []) parts.push(`<p>${escapeHtml(p)}</p>`);
  const list = (title, items) => {
    if (!items?.length) return;
    parts.push(`<p><strong>${title}</strong></p><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`);
  };
  list('Principal Accountabilities', fields.principalAccountabilities?.value);
  list('Duties and Responsibilities', fields.duties?.value);
  return parts.join('');
}

// The vacancy form, pre-filled from what was read. Only what the document
// states - screening criteria and questions are HR's to add.
function prefillFrom(fields, organogram) {
  const v = (key) => fields[key]?.value;
  const prefill = {};
  if (organogram.department) prefill.departmentId = organogram.department.id;
  if (organogram.position) prefill.positionId = organogram.position.id;
  if (organogram.reportsTo) prefill.reportsToPositionId = organogram.reportsTo.id;
  if (v('vacancies')) prefill.positionsRequired = v('vacancies');
  if (v('advertType')) prefill.postingType = v('advertType');
  if (v('salaryScale')) prefill.salaryScale = v('salaryScale');
  if (v('station')) prefill.location = v('station');
  if (v('contractType')) prefill.employmentCategory = v('contractType');
  if (v('age')?.minimumAge) prefill.minimumAge = v('age').minimumAge;
  if (v('age')?.maximumAge) prefill.maximumAge = v('age').maximumAge;
  const html = jobPurposeHtml(fields);
  if (html) prefill.jobPurpose = html;
  if (v('essential')) prefill.essentialRequirements = v('essential');
  if (v('desirable')) prefill.desirableQualifications = v('desirable');
  if (v('knowledge')) prefill.generalKnowledge = v('knowledge');
  if (v('specialSkills')) prefill.specialSkills = v('specialSkills');
  return prefill;
}

// Another vacancy already created from this exact document, or null.
function findVacancyWithHash(hash) {
  return prisma.vacancy.findFirst({
    where: { requisitionDocumentHash: hash },
    select: { id: true, jobRef: true, title: true, status: true }
  });
}

function duplicateError(existing) {
  const err = new AppError(
    `This requisition has already been used for vacancy ${existing.jobRef} (${existing.title}). `
    + 'One approved requisition opens one vacancy - readvertise that vacancy instead if it needs to run again.', 409
  );
  err.code = 'DUPLICATE_REQUISITION';
  err.existing = existing;
  return err;
}

async function readStored(filename) {
  const filePath = storedPath(filename);
  const buffer = fs.readFileSync(filePath);
  const mimetype = MIME_FOR_EXT[filename.split('.').pop()];
  const { text, format, pages } = await extractDocumentText(buffer, mimetype);
  const parsed = parseRequisitionText(text, { format });
  return { buffer, format, pages, parsed, hash: hashOf(buffer) };
}

/**
 * Step 1 - after the upload middleware stored the file. Reads it and returns
 * the review data. A document that can't be read, or that already backs a
 * vacancy, is deleted again and refused.
 */
async function read(file) {
  let stored;
  try {
    stored = await readStored(file.filename);
    const existing = await findVacancyWithHash(stored.hash);
    if (existing) throw duplicateError(existing);
  } catch (err) {
    fs.rm(path.join(uploadDir, file.filename), { force: true }, () => {});
    throw err;
  }
  const organogram = await matchOrganogram(stored.parsed.fields);
  return {
    document: {
      filename: file.filename, url: `/api/files/${file.filename}`,
      originalName: String(file.originalname || 'requisition').slice(0, MAX_NAME_LENGTH),
      format: stored.format, pages: stored.pages
    },
    fields: stored.parsed.fields,
    labels: stored.parsed.labels,
    missing: stored.parsed.missing,
    organogram: { department: organogram.department, position: organogram.position, reportsTo: organogram.reportsTo },
    warnings: [...stored.parsed.warnings, ...organogram.warnings],
    prefill: prefillFrom(stored.parsed.fields, organogram)
  };
}

// The form fields HR changed from what the document said - kept with the
// snapshot so the history shows where the vacancy departs from its approval.
// The department follows from the position, so it isn't compared on its
// own; rich text is compared as plain text, since the editor may rewrite
// the markup without changing a word; a field the form didn't send isn't
// a change.
const COMPARED_FIELDS = ['positionId', 'reportsToPositionId', 'positionsRequired', 'postingType', 'salaryScale',
  'location', 'employmentCategory', 'minimumAge', 'maximumAge', 'jobPurpose', 'essentialRequirements',
  'desirableQualifications', 'generalKnowledge', 'specialSkills'];

function comparable(key, value) {
  if (value === undefined || value === null || value === '') return null;
  if (key === 'jobPurpose') return String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => String(v).trim()).filter(Boolean));
  return String(value).trim();
}

function editedFields(prefill, body) {
  return COMPARED_FIELDS.filter((key) => key in body && comparable(key, prefill[key]) !== comparable(key, body[key]));
}

/**
 * Step 2 - at vacancy creation. Re-reads the stored document and returns the
 * Vacancy columns that record it. Throws AppError (400/404/409/422).
 */
async function forCreate(body, createdById) {
  const doc = body.requisitionDocument;
  if (!doc?.filename) {
    const err = new AppError('Upload the EXCO-approved, signed requisition first - a vacancy can only be created from one.', 400);
    err.code = 'REQUISITION_REQUIRED';
    throw err;
  }
  if (body.requisitionConfirmed !== true) {
    const err = new AppError('Confirm that the uploaded requisition has been approved and signed by EXCO.', 400);
    err.code = 'REQUISITION_NOT_CONFIRMED';
    throw err;
  }
  const stored = await readStored(doc.filename);
  const existing = await findVacancyWithHash(stored.hash);
  if (existing) throw duplicateError(existing);

  const organogram = await matchOrganogram(stored.parsed.fields);
  const prefill = prefillFrom(stored.parsed.fields, organogram);
  return {
    requisitionDocumentUrl: `/api/files/${doc.filename}`,
    requisitionDocumentName: String(doc.originalName || doc.filename).slice(0, MAX_NAME_LENGTH),
    requisitionDocumentHash: stored.hash,
    requisitionUploadedAt: new Date(),
    requisitionUploadedById: createdById,
    requisitionDetails: {
      format: stored.format,
      fields: stored.parsed.fields,
      missing: stored.parsed.missing,
      warnings: stored.parsed.warnings,
      editedFields: editedFields(prefill, body)
    }
  };
}

// What a readvertisement carries over from the vacancy it re-runs.
function carriedOver(vacancy) {
  return {
    requisitionDocumentUrl: vacancy.requisitionDocumentUrl,
    requisitionDocumentName: vacancy.requisitionDocumentName,
    requisitionUploadedAt: vacancy.requisitionUploadedAt,
    requisitionUploadedById: vacancy.requisitionUploadedById,
    requisitionDetails: vacancy.requisitionDetails
    // requisitionDocumentHash stays with the original only - it marks the
    // vacancy the document was first used for.
  };
}

module.exports = { read, forCreate, carriedOver, matchOrganogram, prefillFrom, jobPurposeHtml, editedFields, FILENAME_RE };
