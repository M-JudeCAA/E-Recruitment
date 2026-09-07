const candidateModel = require('../models/candidateModel');
const internalProfileModel = require('../models/internalProfileModel');
const applicationModel = require('../models/applicationModel');
const profileEntriesModel = require('../models/profileEntriesModel');

async function me(req, res) {
  const candidate = await candidateModel.findById(req.user.id, {
    workExperience: true, education: true, internalProfile: true
  });
  res.json(candidate);
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
  res.status(201).json(entry);
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
  res.json(profile);
}

async function myApplications(req, res) {
  const applications = await applicationModel.findByCandidate(req.user.id);
  res.json(applications);
}

module.exports = { me, addWorkExperience, addEducation, updateInternalProfile, myApplications };
