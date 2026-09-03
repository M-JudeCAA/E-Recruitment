const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const offerModel = require('../models/offerModel');
const workflow = require('../services/workflowService');
const { validateVacancyInput } = require('../utils/vacancyValidation');

async function create(req, res) {
  const errors = validateVacancyInput(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { title, department, positionsRequired, postingType, deadline, regulatoryDriver, category, priority } = req.body;
  const vacancy = await vacancyModel.create({
    title: title.trim(),
    department: department.trim(),
    positionsRequired: positionsRequired !== undefined ? Number(positionsRequired) : 1,
    postingType: postingType || 'Open',
    deadline: deadline ? new Date(deadline) : null,
    regulatoryDriver, category, priority,
    createdById: req.user.id
  });
  res.status(201).json(vacancy);
}

// Previously missing entirely - there was no way to fix a typo or push
// back a deadline after a vacancy was created.
async function update(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const errors = validateVacancyInput(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ errors });

  const { title, department, positionsRequired, postingType, deadline, regulatoryDriver, category, priority } = req.body;
  const data = {};
  if (title !== undefined) data.title = title.trim();
  if (department !== undefined) data.department = department.trim();
  if (postingType !== undefined) data.postingType = postingType;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (regulatoryDriver !== undefined) data.regulatoryDriver = regulatoryDriver;
  if (category !== undefined) data.category = category;
  if (priority !== undefined) data.priority = priority;

  if (positionsRequired !== undefined) {
    const n = Number(positionsRequired);
    const acceptedCount = await offerModel.countAccepted(vacancyId);
    if (n < acceptedCount) {
      return res.status(422).json({
        error: `Cannot reduce positions required below ${acceptedCount}, the number of offers already accepted for this vacancy`
      });
    }
    data.positionsRequired = n;
  }

  const updated = await vacancyModel.update(vacancyId, data);
  res.json(updated);
}

// Previously unreachable - VacancyStatus.Closed existed in the schema but
// nothing ever set it, so a withdrawn vacancy had no way to come down.
async function close(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (vacancy.status === 'Closed') {
    return res.status(422).json({ error: 'This vacancy is already closed' });
  }

  const updated = await vacancyModel.update(vacancyId, { status: 'Closed' });
  res.json(updated);
}

async function approve(req, res) {
  const vacancyId = Number(req.params.id);
  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const vacancy = await vacancyModel.update(vacancyId, { status: 'Open' });
  res.json(vacancy);
}

// candidateType now comes from a verified JWT (req.user, set only if a
// valid token was presented) rather than a client-supplied query string.
// Previously, an anonymous or unauthenticated request - or one that simply
// omitted the query param - fell through with no posting-type filter at
// all, exposing Internal-only vacancies to anyone. The safe default now is
// "treat as External" unless a genuinely verified Internal candidate token
// says otherwise.
async function listPublic(req, res) {
  const candidateType = req.user?.type === 'candidate' ? req.user.candidateType : 'External';

  let where = { status: { in: ['Open', 'PartiallyFilled'] } };
  if (candidateType !== 'Internal') {
    where.postingType = { in: ['External', 'Open'] };
  }
  const vacancies = await vacancyModel.findMany(where);
  res.json(vacancies);
}

async function listForAdmin(req, res) {
  const where = req.user.role === 'DHRA_Manager_HR' ? {} : { department: req.user.department };
  const vacancies = await vacancyModel.findManyForAdmin(where);
  res.json(vacancies);
}

async function getOne(req, res) {
  const vacancy = await vacancyModel.findById(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'Not found' });
  res.json(vacancy);
}

async function listApplications(req, res) {
  const applications = await applicationModel.findByVacancy(Number(req.params.id));
  res.json(applications);
}

async function saveRanking(req, res) {
  const vacancyId = Number(req.params.id);
  const { applicationIds } = req.body;

  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const updates = [];
  for (let i = 0; i < applicationIds.length; i++) {
    const appId = applicationIds[i];
    try {
      await workflow.assertCanShortlist(appId);
    } catch (err) {
      return res.status(422).json({ error: `Application ${appId}: ${err.message}` });
    }
    const listStatus = i < vacancy.positionsRequired ? 'Primary' : 'Reserve';
    updates.push(applicationModel.update(appId, { rank: i + 1, listStatus, status: 'Shortlisted' }));
  }

  const results = await Promise.all(updates);
  res.json(results);
}

module.exports = { create, update, close, approve, listPublic, listForAdmin, getOne, listApplications, saveRanking };
