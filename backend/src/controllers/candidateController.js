const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const applicationModel = require('../models/applicationModel');
const profileEntriesModel = require('../models/profileEntriesModel');
const { validateNationalId } = require('../utils/validators');
const { checkAndFireCompletionEvent } = require('../services/profileCompletionService');
const { fileUrl } = require('../middleware/upload');

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
    workExperience: true, education: true, internalProfile: true
  });
  res.json(omitPasswordHash(candidate));
}

async function addWorkExperience(req, res) {
  const { employer, jobTitle, startDate, endDate } = req.body;
  const entry = await profileEntriesModel.createWorkExperience({
    candidateId: req.user.id, employer, jobTitle,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : null
  });
  res.status(201).json(entry);
}

const EDUCATION_LEVELS = ['Certificate', 'Diploma', 'Bachelors', 'Masters', 'PhD'];

// qualificationLevel is now a controlled, ordered dropdown (Decision #13
// in the candidate application workflow spec) rather than free text -
// required for any "meets minimum education" screening comparison to
// mean anything reliable. qualificationLevelText is kept alongside it,
// set to the same value at entry time, since it's still what older,
// unmapped rows are readable from (see scripts/migrateEducationLevels.js).
async function addEducation(req, res) {
  const { institution, qualificationLevel, fieldOfStudy, yearCompleted } = req.body;
  if (!EDUCATION_LEVELS.includes(qualificationLevel)) {
    return res.status(400).json({ error: `Qualification level must be one of: ${EDUCATION_LEVELS.join(', ')}` });
  }
  const entry = await profileEntriesModel.createEducation({
    candidateId: req.user.id, institution,
    qualificationLevelText: qualificationLevel,
    qualificationLevel,
    fieldOfStudy,
    yearCompleted: yearCompleted ? Number(yearCompleted) : null
  });
  await checkAndFireCompletionEvent(req.user.id);
  res.status(201).json(entry);
}

async function updateEducation(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid education id' });
  const { institution, qualificationLevel, fieldOfStudy, yearCompleted } = req.body;
  if (!EDUCATION_LEVELS.includes(qualificationLevel)) {
    return res.status(400).json({ error: `Qualification level must be one of: ${EDUCATION_LEVELS.join(', ')}` });
  }
  const result = await profileEntriesModel.updateEducation(id, req.user.id, {
    institution, qualificationLevelText: qualificationLevel, qualificationLevel, fieldOfStudy,
    yearCompleted: yearCompleted ? Number(yearCompleted) : null
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
  const { employer, jobTitle, startDate, endDate } = req.body;
  const result = await profileEntriesModel.updateWorkExperience(id, req.user.id, {
    employer, jobTitle,
    startDate: new Date(startDate),
    endDate: endDate ? new Date(endDate) : null
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

const WORK_AUTHORIZATION_VALUES = ['Yes', 'No', 'Sponsorship'];

// Candidate-level profile fields (location, NIN, work authorization,
// LinkedIn/portfolio links) - persist across every application this
// candidate ever submits, same principle as education/workExperience.
// nationalId already existed on Candidate (set at registration); this is
// the first endpoint that lets a candidate edit it afterward.
const ID_TYPE_VALUES = ['NationalID', 'Passport'];

async function updateProfile(req, res) {
  const { nationalId, idType, location, linkedinUrl, portfolioUrl, workAuthorization } = req.body;
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

  const candidate = await candidateModel.update(req.user.id, data);
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

async function myApplications(req, res) {
  const applications = await applicationModel.findByCandidate(req.user.id);
  res.json(applications);
}

module.exports = {
  me, addWorkExperience, addEducation, updateProfile, updateInternalProfile, myApplications,
  updateEducation, deleteEducation, updateWorkExperience, deleteWorkExperience,
  updatePhoto, removePhoto
};
