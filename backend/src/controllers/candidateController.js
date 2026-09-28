const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const applicationModel = require('../models/applicationModel');
const profileEntriesModel = require('../models/profileEntriesModel');
const { validateNationalId } = require('../utils/validators');
const { checkAndFireCompletionEvent } = require('../services/profileCompletionService');
const { fileUrl } = require('../middleware/upload');
const { educationKey, workExperienceKey, certificateKey, examGradeKey } = require('../utils/entryDedup');
const { normalizeStringList } = require('../utils/vacancyValidation');
const { toPublicVacancy } = require('../utils/publicVacancy');
const { toCandidateInterview } = require('../utils/candidateInterview');

// Candidate rows carry passwordHash - fine for the internal auth-check
// reads in candidateAuthController, but every response here goes straight
// to the candidate's own browser as JSON, so it must never ride along.
function omitPasswordHash(candidate) {
  if (!candidate) return candidate;
  const { passwordHash, ...safe } = candidate;
  return safe;
}

async function me(req, res) {
  const candidate = await candidateModel.findById(req.user.id, {
    workExperience: true, education: true, examGrades: true, certificates: true, internalProfile: true
  });
  res.json(omitPasswordHash(candidate));
}

async function addWorkExperience(req, res) {
  const { employer, jobTitle, startDate, endDate, duties } = req.body;

  // Idempotent: re-submitting an entry equivalent to one already on file
  // (a re-uploaded CV suggesting the same role again, a retried or
  // double-clicked request) returns the existing row instead of creating
  // a duplicate - see entryDedup.js for what counts as "equivalent". Not
  // keyed on duties - a later edit that only fills in/refines the duty
  // list for the same role is still the same entry, not a new one.
  const existing = await profileEntriesModel.findWorkExperienceForCandidate(req.user.id);
  const key = workExperienceKey({ employer, jobTitle, startDate });
  const duplicate = existing.find((e) => workExperienceKey(e) === key);
  if (duplicate) return res.status(200).json(duplicate);

  const entry = await profileEntriesModel.createWorkExperience({
    candidateId: req.user.id, employer, jobTitle,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : null,
    duties: normalizeStringList(duties) || []
  });
  await checkAndFireCompletionEvent(req.user.id);
  res.status(201).json(entry);
}

// OLevel/ALevel deliberately excluded here even though EducationLevel's
// enum now includes them (schema.prisma) - those belong on the dedicated
// ExamGrade model (subject + grade pairs, see addExamGrade below), not as
// a single-value "qualification level" on a generic Education entry.
// Postgraduate added to match the same enum widening.
const EDUCATION_LEVELS = ['Certificate', 'Diploma', 'Bachelors', 'Postgraduate', 'Masters', 'PhD'];

// qualificationLevel is now a controlled, ordered dropdown (Decision #13
// in the candidate application workflow spec) rather than free text -
// required for any "meets minimum education" screening comparison to
// mean anything reliable. qualificationLevelText is kept alongside it,
// set to the same value at entry time, since it's still what older,
// unmapped rows are readable from (see scripts/migrateEducationLevels.js).
// Optional, 0-5 scale (see Vacancy.minimumCGPA) - null is "not provided",
// not "0.0", so an empty/undefined input is left as null rather than
// coerced to a number.
function parseCGPA(cgpa) {
  if (cgpa === undefined || cgpa === null || cgpa === '') return { value: null };
  const n = Number(cgpa);
  if (!Number.isFinite(n) || n <= 0 || n > 5) return { error: 'CGPA must be a number greater than 0 and at most 5' };
  return { value: n };
}

async function addEducation(req, res) {
  const { institution, qualificationLevel, fieldOfStudy, yearCompleted, cgpa } = req.body;
  if (!EDUCATION_LEVELS.includes(qualificationLevel)) {
    return res.status(400).json({ error: `Qualification level must be one of: ${EDUCATION_LEVELS.join(', ')}` });
  }
  const parsedCGPA = parseCGPA(cgpa);
  if (parsedCGPA.error) return res.status(400).json({ error: parsedCGPA.error });

  // Idempotent - see addWorkExperience's comment above; same reasoning.
  const existing = await profileEntriesModel.findEducationForCandidate(req.user.id);
  const key = educationKey({ institution, qualificationLevel, fieldOfStudy });
  const duplicate = existing.find((e) => educationKey(e) === key);
  if (duplicate) return res.status(200).json(duplicate);

  const entry = await profileEntriesModel.createEducation({
    candidateId: req.user.id, institution,
    qualificationLevelText: qualificationLevel,
    qualificationLevel,
    fieldOfStudy,
    yearCompleted: yearCompleted ? Number(yearCompleted) : null,
    cgpa: parsedCGPA.value
  });
  await checkAndFireCompletionEvent(req.user.id);
  res.status(201).json(entry);
}

async function updateEducation(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid education id' });
  const { institution, qualificationLevel, fieldOfStudy, yearCompleted, cgpa } = req.body;
  if (!EDUCATION_LEVELS.includes(qualificationLevel)) {
    return res.status(400).json({ error: `Qualification level must be one of: ${EDUCATION_LEVELS.join(', ')}` });
  }
  const parsedCGPA = parseCGPA(cgpa);
  if (parsedCGPA.error) return res.status(400).json({ error: parsedCGPA.error });
  const result = await profileEntriesModel.updateEducation(id, req.user.id, {
    institution, qualificationLevelText: qualificationLevel, qualificationLevel, fieldOfStudy,
    yearCompleted: yearCompleted ? Number(yearCompleted) : null,
    cgpa: parsedCGPA.value
  });
  if (result.count === 0) return res.status(404).json({ error: 'Education entry not found' });
  await checkAndFireCompletionEvent(req.user.id);
  res.json({ message: 'Education entry updated' });
}

async function deleteEducation(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid education id' });
  const result = await profileEntriesModel.deleteEducation(id, req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Education entry not found' });
  res.json({ message: 'Education entry deleted' });
}

async function updateWorkExperience(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid work experience id' });
  const { employer, jobTitle, startDate, endDate, duties } = req.body;
  const result = await profileEntriesModel.updateWorkExperience(id, req.user.id, {
    employer, jobTitle,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : null,
    duties: normalizeStringList(duties) || []
  });
  if (result.count === 0) return res.status(404).json({ error: 'Work experience entry not found' });
  res.json({ message: 'Work experience entry updated' });
}

async function deleteWorkExperience(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid work experience id' });
  const result = await profileEntriesModel.deleteWorkExperience(id, req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Work experience entry not found' });
  res.json({ message: 'Work experience entry deleted' });
}

// Optional - unlike education/work experience, never checked by
// profileCompleteness.js, and adding one never fires checkAndFireCompletionEvent.
async function addCertificate(req, res) {
  const { name, issuingOrganization, issueDate, expiryDate } = req.body;
  if (!name || !issuingOrganization) {
    return res.status(400).json({ error: 'Certificate name and issuing organization are required' });
  }

  // Idempotent - see addWorkExperience's comment above; same reasoning.
  // expiryDate is left out of the key so correcting/adding it later
  // doesn't spawn a duplicate row.
  const existing = await profileEntriesModel.findCertificatesForCandidate(req.user.id);
  const key = certificateKey({ name, issuingOrganization, issueDate });
  const duplicate = existing.find((c) => certificateKey(c) === key);
  if (duplicate) return res.status(200).json(duplicate);

  const entry = await profileEntriesModel.createCertificate({
    candidateId: req.user.id, name, issuingOrganization,
    issueDate: issueDate ? new Date(issueDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null
  });
  res.status(201).json(entry);
}

async function updateCertificate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });
  const { name, issuingOrganization, issueDate, expiryDate } = req.body;
  if (!name || !issuingOrganization) {
    return res.status(400).json({ error: 'Certificate name and issuing organization are required' });
  }
  const result = await profileEntriesModel.updateCertificate(id, req.user.id, {
    name, issuingOrganization,
    issueDate: issueDate ? new Date(issueDate) : null,
    expiryDate: expiryDate ? new Date(expiryDate) : null
  });
  if (result.count === 0) return res.status(404).json({ error: 'Certificate entry not found' });
  res.json({ message: 'Certificate entry updated' });
}

async function deleteCertificate(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });
  const result = await profileEntriesModel.deleteCertificate(id, req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Certificate entry not found' });
  res.json({ message: 'Certificate entry deleted' });
}

const SECONDARY_LEVELS = ['OLevel', 'ALevel'];
const O_LEVEL_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const A_LEVEL_GRADES = ['A', 'B', 'C', 'D', 'E', 'O', 'F'];

function validateExamGradeInput({ level, subject, grade }) {
  if (!SECONDARY_LEVELS.includes(level)) return `Level must be one of: ${SECONDARY_LEVELS.join(', ')}`;
  if (!subject) return 'Subject is required';
  const validGrades = level === 'OLevel' ? O_LEVEL_GRADES : A_LEVEL_GRADES;
  if (!validGrades.includes(grade)) return `Grade must be one of: ${validGrades.join(', ')}`;
  return null;
}

// Optional, same as Certificate above - never part of
// profileCompleteness's required fields, so no checkAndFireCompletionEvent
// call here either.
async function addExamGrade(req, res) {
  const { level, subject, grade } = req.body;
  const validationError = validateExamGradeInput({ level, subject, grade });
  if (validationError) return res.status(400).json({ error: validationError });

  // Idempotent - see addWorkExperience's comment above; same reasoning.
  // grade is excluded from the key (see examGradeKey), so a corrected
  // grade for the same subject/level is a job for the "edit" action, not
  // a second add.
  const existing = await profileEntriesModel.findExamGradesForCandidate(req.user.id);
  const key = examGradeKey({ level, subject });
  const duplicate = existing.find((g) => examGradeKey(g) === key);
  if (duplicate) return res.status(200).json(duplicate);

  const entry = await profileEntriesModel.createExamGrade({ candidateId: req.user.id, level, subject, grade });
  res.status(201).json(entry);
}

async function updateExamGrade(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid exam grade id' });
  const { level, subject, grade } = req.body;
  const validationError = validateExamGradeInput({ level, subject, grade });
  if (validationError) return res.status(400).json({ error: validationError });
  const result = await profileEntriesModel.updateExamGrade(id, req.user.id, { level, subject, grade });
  if (result.count === 0) return res.status(404).json({ error: 'Exam grade entry not found' });
  res.json({ message: 'Exam grade entry updated' });
}

async function deleteExamGrade(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid exam grade id' });
  const result = await profileEntriesModel.deleteExamGrade(id, req.user.id);
  if (result.count === 0) return res.status(404).json({ error: 'Exam grade entry not found' });
  res.json({ message: 'Exam grade entry deleted' });
}

const WORK_AUTHORIZATION_VALUES = ['Yes', 'No', 'Sponsorship'];

// Candidate-level profile fields (location, NIN, work authorization,
// LinkedIn/portfolio links) - persist across every application this
// candidate ever submits, same principle as education/workExperience.
// nationalId already existed on Candidate (set at registration); this is
// the first endpoint that lets a candidate edit it afterward.
const ID_TYPE_VALUES = ['NationalID', 'Passport'];

async function updateProfile(req, res) {
  const { nationalId, idType, location, linkedinUrl, portfolioUrl, workAuthorization, dateOfBirth, flyingHours } = req.body;
  if (workAuthorization !== undefined && workAuthorization !== '' && !WORK_AUTHORIZATION_VALUES.includes(workAuthorization)) {
    return res.status(400).json({ error: `Work authorization must be one of: ${WORK_AUTHORIZATION_VALUES.join(', ')}` });
  }
  if (idType !== undefined && idType !== '' && !ID_TYPE_VALUES.includes(idType)) {
    return res.status(400).json({ error: `ID type must be one of: ${ID_TYPE_VALUES.join(', ')}` });
  }
  // The Uganda NIN format is only enforced for candidates who declared
  // their id as a National ID in this same request - a foreign candidate's
  // passport format varies too much by country to validate meaningfully,
  // and idType/nationalId are always submitted together by the frontend.
  // Deliberately doesn't describe the NIN format - just flags the entry
  // as wrong and asks for a correct one, matching the frontend's own
  // validation message (ProfileCompletionForm.jsx / validators.js).
  if (idType === 'NationalID' && nationalId && !validateNationalId(nationalId)) {
    return res.status(400).json({ error: 'That doesn\'t look like a valid National ID number. Please check and enter it again.' });
  }

  const data = {};
  if (nationalId !== undefined) data.nationalId = nationalId || null;
  if (idType !== undefined) data.idType = idType || null;
  if (location !== undefined) data.location = location || null;
  if (linkedinUrl !== undefined) data.linkedinUrl = linkedinUrl || null;
  if (portfolioUrl !== undefined) data.portfolioUrl = portfolioUrl || null;
  if (workAuthorization !== undefined) data.workAuthorization = workAuthorization || null;
  if (dateOfBirth !== undefined) data.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
  if (flyingHours !== undefined) data.flyingHours = flyingHours !== '' && flyingHours != null ? Number(flyingHours) : null;

  let candidate;
  try {
    candidate = await candidateModel.update(req.user.id, data);
  } catch (err) {
    // nationalId is @unique (see schema.prisma) - two accounts claiming
    // the same National ID/Passport number surfaces here as a Prisma
    // P2002 rather than something worth exposing raw to the candidate.
    if (err.code === 'P2002' && err.meta?.target?.includes('nationalId')) {
      return res.status(409).json({ error: 'This National ID or Passport number is already registered on another account.' });
    }
    throw err;
  }
  await checkAndFireCompletionEvent(req.user.id);
  res.json(omitPasswordHash(candidate));
}

// Optional - never part of profileCompleteness's required fields. Old
// photo files, if any, are deliberately left on disk rather than
// unlinked, matching the rest of this codebase's uploads (a replaced
// cvUrl/coverLetterUrl isn't cleaned up either).
async function updatePhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const candidate = await candidateModel.update(req.user.id, { photoUrl: fileUrl(req.file) });
  res.json(omitPasswordHash(candidate));
}

async function removePhoto(req, res) {
  const candidate = await candidateModel.update(req.user.id, { photoUrl: null });
  res.json(omitPasswordHash(candidate));
}

async function updateInternalProfile(req, res) {
  if (req.user.candidateType !== 'Internal') {
    return res.status(403).json({ error: 'Only internal candidates have an internal profile' });
  }
  const { employeeId, department, position, dateJoined, supervisorName, supervisorEmail } = req.body;
  const profile = await internalProfileModel.updateByCandidateId(req.user.id, {
    employeeId, department, position,
    dateJoined: dateJoined ? new Date(dateJoined) : null,
    supervisorName, supervisorEmail
  });
  await checkAndFireCompletionEvent(req.user.id);
  res.json(profile);
}

// Each application embeds its full Vacancy row (include: { vacancy: true }),
// which carries HR-only columns - strip them before they reach the candidate.
async function myApplications(req, res) {
  const applications = await applicationModel.findByCandidate(req.user.id);
  // Interview rounds go through the same kind of whitelist as the vacancy -
  // the panel's scores, recommendation and HR's internal notes stay staff-only.
  res.json(applications.map((a) => ({
    ...a,
    vacancy: toPublicVacancy(a.vacancy),
    interviewRounds: (a.interviewRounds || [])
      .slice().sort((x, y) => x.roundNumber - y.roundNumber)
      .map(toCandidateInterview)
  })));
}

module.exports = {
  me, addWorkExperience, addEducation, updateProfile, updateInternalProfile, myApplications,
  updateEducation, deleteEducation, updateWorkExperience, deleteWorkExperience,
  addCertificate, updateCertificate, deleteCertificate,
  addExamGrade, updateExamGrade, deleteExamGrade,
  updatePhoto, removePhoto
};
