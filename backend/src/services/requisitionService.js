const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');
const departmentModel = require('../models/departmentModel');
const positionModel = require('../models/positionModel');
const reportingLines = require('./reportingLineService');
const { extractDocumentText, PDF_MIME, DOCX_MIME } = require('../utils/documentText');
const { parseRequisitionText, normalizeLabel } = require('../utils/requisitionParser');
const { AppError } = require('../utils/errorResponse');
const { escapeHtml, zonedDateTime, formatDeadline } = require('../utils/interviewFormat');
const { DEFAULT_DEADLINE_TIME } = require('../utils/vacancyValidation');
const { suggestScreening } = require('../utils/screeningSuggestions');

// A vacancy is created only from an EXCO-approved, signed requisition that
// HR uploads (there is no requisition workflow inside this system - the
// approval happens at EXCO, on paper or digitally, before HR gets here).
//
//   1. POST /api/vacancies/requisition stores the document (PDF or .docx
//      with a text layer - scans are refused), reads the job details out of
//      it, matches them to the organogram, and hands back a pre-filled
//      vacancy form with a confidence for every field (read()).
//   2. HR uploads the scan of the requisition as EXCO signed it
//      (storeSignedCopy) - the document above carries the text, the scan
//      the signatures, and both are kept on the vacancy.
//   3. HR reviews and corrects the form, confirms the EXCO approval, adds
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
const SIGNED_COPY_FILENAME_RE = /^requisition-signed-[0-9a-f-]{36}\.(pdf|jpg|png)$/;
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

function signedCopyPath(filename) {
  if (!SIGNED_COPY_FILENAME_RE.test(filename || '')) throw new AppError('That signed copy upload is not valid - upload the scan again.', 400);
  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir + path.sep) || !fs.existsSync(filePath)) {
    throw new AppError('The uploaded signed copy could not be found - upload the scan again.', 404);
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

// The better of an entry's full name and its short code (a requisition may
// say "ARFFS" or spell it out).
const entryScore = (entry, wanted) => Math.max(nameScore(entry?.name || '', wanted), entry?.code ? nameScore(entry.code, wanted) : 0);

function bestMatch(options, wanted, label) {
  if (!wanted) return { match: null };
  const scored = options.map((o) => ({ o, score: entryScore(o, wanted) })).filter((s) => s.score > 0);
  if (!scored.length) return { match: null, warning: `${label} "${wanted}" is not on the organogram - pick it from the list.` };
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top);
  if (best.length > 1) return { match: null, ambiguous: best.map((s) => s.o), warning: `${label} "${wanted}" matches more than one entry on the organogram - pick the right one.` };
  return { match: best[0].o, confidence: top === 2 ? 'high' : 'medium' };
}

// A job advertisement often names no department ("a vacant position in the
// Corporate Division") - the job title then says where it sits, when only
// one position on the organogram (in that directorate) carries it.
async function departmentFromTitle(fields, inDirectorate) {
  if (!fields.jobTitle?.value) return null;
  let positions = await positionModel.findAllForDropdown();
  if (inDirectorate) positions = positions.filter((p) => inDirectorate.has(p.departmentId));
  const pos = bestMatch(positions, fields.jobTitle.value, 'Job title');
  return pos.match ? pos.match.department : null;
}

async function matchOrganogram(fields) {
  const warnings = [];
  const result = { department: null, position: null, reportsTo: null };

  const departments = await departmentModel.findApproved();
  let deptCandidates = departments;
  // The same department name recurs under different directorates - narrow
  // by the directorate when the document names one.
  let inDirectorate = null;
  if (fields.directorate?.value) {
    const matching = departments.filter((d) => entryScore(d.directorate, fields.directorate.value) > 0);
    if (matching.length) {
      deptCandidates = matching;
      inDirectorate = new Set(matching.map((d) => d.id));
    }
  }
  let dept = fields.department?.value ? bestMatch(deptCandidates, fields.department.value, 'Department') : { match: null };
  if (!dept.match) {
    const found = await departmentFromTitle(fields, inDirectorate);
    if (found) {
      dept = { match: found, confidence: 'medium' };
      warnings.push(fields.department?.value
        ? `Department "${fields.department.value}" is not on the organogram - ${found.name} is where the job title sits; check it.`
        : `The document names no department - ${found.name} is where the job title sits on the organogram; check it.`);
    } else if (dept.warning) {
      warnings.push(dept.warning);
    }
  }
  if (!dept.match) return { ...result, warnings };
  result.department = { id: dept.match.id, name: dept.match.name, directorate: dept.match.directorate?.name || null, confidence: dept.confidence };

  const positions = await positionModel.findByDepartment(dept.match.id);
  const pos = bestMatch(positions, fields.jobTitle?.value, 'Job title');
  if (pos.warning) warnings.push(pos.warning);
  if (!pos.match) return { ...result, warnings };
  result.position = { id: pos.match.id, name: pos.match.name, confidence: pos.confidence };

  // The requisition always says who the job reports to - matched among
  // who the position may report to (reportingLineService). Only when it
  // doesn't say is the head its reporting line points to used.
  const { options, suggestedId } = await reportingLines.optionsFor({ ...pos.match, department: dept.match });
  if (fields.reportsTo?.value) {
    const rep = bestMatch(options, fields.reportsTo.value, 'Reports to');
    if (rep.match) {
      result.reportsTo = { id: rep.match.id, name: rep.match.name, confidence: rep.confidence };
    } else {
      // Say where it is when it exists but can't be chosen for this job.
      const anywhere = bestMatch(await positionModel.findAllForDropdown(), fields.reportsTo.value, 'Reports to');
      warnings.push(anywhere.match
        ? `Reports to "${fields.reportsTo.value}" is ${anywhere.match.name} (${anywhere.match.department?.name}), which this job can't report to (only someone more senior in its department, or the head of the directorate) - pick who it reports to from the list.`
        : rep.warning);
    }
  } else if (suggestedId) {
    const head = options.find((o) => o.id === suggestedId);
    result.reportsTo = { id: head.id, name: head.name, confidence: 'medium' };
  }
  return { ...result, warnings };
}

// Job purpose, principal accountabilities and duties as one block of
// advert HTML - the same shape HR used to paste into the Job purpose field.
function jobPurposeHtml(fields) {
  const parts = [];
  for (const p of fields.jobPurpose?.value || []) parts.push(`<p>${escapeHtml(p)}</p>`);
  const bullets = (items) => `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  const list = (title, field) => {
    if (!field?.value?.length) return;
    // The JD table: each accountability, numbered, with its activities.
    if (field.groups?.length) {
      const items = field.groups.map((g) => `<li>${g.heading ? `<strong>${escapeHtml(g.heading)}</strong>` : ''}${g.items.length ? bullets(g.items) : ''}</li>`);
      parts.push(`<p><strong>${title}</strong></p><ol>${items.join('')}</ol>`);
      return;
    }
    parts.push(`<p><strong>${title}</strong></p>${bullets(field.value)}`);
  };
  list('Principal Accountabilities', fields.principalAccountabilities);
  list('Duties and Responsibilities', fields.duties);
  return parts.join('');
}

// The document's closing date as the form's two fields - the day and the
// closing time, 5:00pm when it gives none.
function deadlineParts(fields) {
  const v = fields.deadline?.value;
  if (!v) return null;
  const [date, time] = v.split('T');
  return { date, time: time || DEFAULT_DEADLINE_TIME };
}

// The advert's closing date fills the deadline only while it is still ahead.
function deadlineWarning(fields) {
  const parts = deadlineParts(fields);
  if (!parts) return null;
  const closes = zonedDateTime(parts.date, parts.time);
  if (closes > new Date()) return null;
  return `The closing date in the document (${formatDeadline(closes)}) has passed - set the deadline for this advert.`;
}

// The vacancy form, pre-filled from what was read: what the document states,
// and the screening its Essential Requirements suggest (minimum education and
// experience, and a question on the field - utils/screeningSuggestions.js),
// which HR confirms or changes on the form.
function prefillFrom(fields, organogram) {
  const v = (key) => fields[key]?.value;
  const prefill = {};
  if (organogram.department) prefill.departmentId = organogram.department.id;
  if (organogram.position) prefill.positionId = organogram.position.id;
  if (organogram.reportsTo) prefill.reportsToPositionId = organogram.reportsTo.id;
  if (v('vacancies')) prefill.positionsRequired = v('vacancies');
  if (v('advertType')) prefill.postingType = v('advertType');
  if (v('salaryScale')) prefill.salaryScale = v('salaryScale');
  if (deadlineParts(fields) && !deadlineWarning(fields)) {
    prefill.deadline = deadlineParts(fields).date;
    prefill.deadlineTime = deadlineParts(fields).time;
  }
  if (v('station')) prefill.location = v('station');
  if (v('contractType')) prefill.employmentCategory = v('contractType');
  if (v('age')?.minimumAge) prefill.minimumAge = v('age').minimumAge;
  if (v('age')?.maximumAge) prefill.maximumAge = v('age').maximumAge;
  const html = jobPurposeHtml(fields);
  if (html) prefill.jobPurpose = html;
  if (v('essential')) prefill.essentialRequirements = v('essential');
  const screening = suggestScreening(v('essential'));
  if (screening.minimumEducationLevel) prefill.minimumEducationLevel = screening.minimumEducationLevel;
  if (screening.minimumExperienceYears) prefill.minimumExperienceYears = screening.minimumExperienceYears;
  if (screening.preferredFieldOfStudy) prefill.preferredFieldOfStudy = screening.preferredFieldOfStudy;
  if (screening.disqualifyingQuestion) prefill.disqualifyingRequirements = [screening.disqualifyingQuestion];
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
// FR-ATS-018: an advert can't go out on a job description that isn't
// approved, unless an exception is authorised. The requisition states the
// JD status; 'unknown' when it doesn't say (or says something unclear).
function jdApproval(fields) {
  const raw = fields.jdStatus?.value;
  if (!raw) return 'unknown';
  if (/\bnot\s+approved\b|\bunapproved\b|\bpending\b|\bdraft\b|\bunder\s+review\b|\bawaiting\b/i.test(raw)) return 'notApproved';
  if (/\bapproved\b/i.test(raw)) return 'approved';
  return 'unknown';
}

const JD_NOT_APPROVED_WARNING = 'The requisition says the job description is not approved. A vacancy can only be created on it '
  + 'as an exception: give the reason, and whoever approves the vacancy must authorise it.';
const MIN_EXCEPTION_REASON = 10;

async function read(file) {
  let stored;
  try {
    stored = await readStored(file.filename);
    const existing = await findVacancyWithHash(stored.hash);
    if (existing) throw duplicateError(existing);
  } catch (err) {
    await fs.promises.rm(path.join(uploadDir, file.filename), { force: true }).catch(() => {});
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
    warnings: [
      ...(jdApproval(stored.parsed.fields) === 'notApproved' ? [JD_NOT_APPROVED_WARNING] : []),
      ...stored.parsed.warnings, ...organogram.warnings,
      ...(deadlineWarning(stored.parsed.fields) ? [deadlineWarning(stored.parsed.fields)] : [])
    ],
    jdStatus: jdApproval(stored.parsed.fields),
    // What the Essential Requirements suggest screening should check, and the
    // requirement each came from - shown to HR beside the form.
    screening: suggestScreening(stored.parsed.fields.essential?.value),
    prefill: prefillFrom(stored.parsed.fields, organogram)
  };
}

// The form fields HR changed from what the document said - kept with the
// snapshot so the history shows where the vacancy departs from its approval.
// The department follows from the position, so it isn't compared on its
// own; rich text is compared as plain text, since the editor may rewrite
// the markup without changing a word; a field the form didn't send isn't
// a change.
const COMPARED_FIELDS = ['positionId', 'reportsToPositionId', 'positionsRequired', 'postingType', 'salaryScale', 'deadline',
  'location', 'employmentCategory', 'minimumAge', 'maximumAge', 'minimumEducationLevel', 'minimumExperienceYears',
  'preferredFieldOfStudy', 'jobPurpose', 'essentialRequirements',
  'desirableQualifications', 'generalKnowledge', 'specialSkills'];

function comparable(key, value) {
  if (value === undefined || value === null || value === '') return null;
  // "2026-05-29" and "2026-05-29T17:00" are the same deadline.
  if (key === 'deadline') {
    const [date, time] = String(value).trim().split(/[T ]/);
    return `${date}T${(time || DEFAULT_DEADLINE_TIME).slice(0, 5)}`;
  }
  if (key === 'jobPurpose') return String(value).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => String(v).trim()).filter(Boolean));
  return String(value).trim();
}

function editedFields(prefill, body) {
  // The prefill holds the closing time apart (the form's time field).
  const read = prefill.deadline && prefill.deadlineTime ? { ...prefill, deadline: `${prefill.deadline}T${prefill.deadlineTime}` } : prefill;
  return COMPARED_FIELDS.filter((key) => key in body
    // Most requisitions give no closing date - HR always sets the deadline,
    // so it departs from the document only when the document gave one.
    && !(key === 'deadline' && !read.deadline)
    && comparable(key, read[key]) !== comparable(key, body[key]));
}

// The scan of the signed requisition, just uploaded (multer has stored it).
// Nothing is read from it; an empty file is refused.
async function storeSignedCopy(file) {
  if (!file.size) {
    await fs.promises.rm(path.join(uploadDir, file.filename), { force: true }).catch(() => {});
    throw new AppError('The signed copy is empty - scan it again.', 422);
  }
  return {
    filename: file.filename, url: `/api/files/${file.filename}`,
    originalName: String(file.originalname || 'signed requisition').slice(0, MAX_NAME_LENGTH),
    contentType: file.mimetype, size: file.size
  };
}

/**
 * At vacancy creation. Re-reads the stored document and returns the
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
  const signed = body.requisitionSignedCopy;
  if (!signed?.filename) {
    const err = new AppError('Upload the scan of the requisition as EXCO signed it - it is kept with the vacancy as evidence of the approval.', 400);
    err.code = 'SIGNED_COPY_REQUIRED';
    throw err;
  }
  const signedHash = hashOf(await fs.promises.readFile(signedCopyPath(signed.filename)));

  // A JD that isn't approved needs an exception, with a reason; the
  // vacancy's approver must then authorise it (vacancyController.approve).
  let jdException = null;
  if (jdApproval(stored.parsed.fields) === 'notApproved') {
    const reason = typeof body.jdExceptionReason === 'string' ? body.jdExceptionReason.trim().slice(0, 2000) : '';
    if (reason.length < MIN_EXCEPTION_REASON) {
      const err = new AppError('The job description on this requisition is not approved. Give the reason for the exception to create the vacancy anyway.', 422);
      err.code = 'JD_NOT_APPROVED';
      throw err;
    }
    jdException = { reason, requestedById: createdById, requestedAt: new Date().toISOString() };
  }

  const organogram = await matchOrganogram(stored.parsed.fields);
  const prefill = prefillFrom(stored.parsed.fields, organogram);
  return {
    requisitionDocumentUrl: `/api/files/${doc.filename}`,
    requisitionDocumentName: String(doc.originalName || doc.filename).slice(0, MAX_NAME_LENGTH),
    requisitionDocumentHash: stored.hash,
    requisitionUploadedAt: new Date(),
    requisitionUploadedById: createdById,
    requisitionSignedCopyUrl: `/api/files/${signed.filename}`,
    requisitionSignedCopyName: String(signed.originalName || signed.filename).slice(0, MAX_NAME_LENGTH),
    requisitionDetails: {
      format: stored.format,
      signedCopy: { hash: signedHash },
      fields: stored.parsed.fields,
      missing: stored.parsed.missing,
      warnings: stored.parsed.warnings,
      editedFields: editedFields(prefill, body),
      jdStatus: jdApproval(stored.parsed.fields),
      ...(jdException ? { jdException } : {})
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
    requisitionSignedCopyUrl: vacancy.requisitionSignedCopyUrl,
    requisitionSignedCopyName: vacancy.requisitionSignedCopyName,
    // A JD exception must be authorised afresh by whoever approves the
    // readvertisement.
    requisitionDetails: vacancy.requisitionDetails?.jdException
      ? { ...vacancy.requisitionDetails, jdException: { reason: vacancy.requisitionDetails.jdException.reason, requestedById: vacancy.requisitionDetails.jdException.requestedById, requestedAt: vacancy.requisitionDetails.jdException.requestedAt } }
      : vacancy.requisitionDetails
    // requisitionDocumentHash stays with the original only - it marks the
    // vacancy the document was first used for.
  };
}

module.exports = {
  read, storeSignedCopy, forCreate, carriedOver, jdApproval, matchOrganogram, prefillFrom, jobPurposeHtml, editedFields,
  FILENAME_RE, SIGNED_COPY_FILENAME_RE
};
