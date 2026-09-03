const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const workflow = require('../services/workflowService');

async function create(req, res) {
  const { title, department, positionsRequired, postingType, deadline, regulatoryDriver, category, priority } = req.body;
  const vacancy = await vacancyModel.create({
    title, department,
    positionsRequired: positionsRequired || 1,
    postingType: postingType || 'Open',
    deadline: deadline ? new Date(deadline) : null,
    regulatoryDriver, category, priority,
    createdById: req.user.id
  });
  res.status(201).json(vacancy);
}

async function approve(req, res) {
  const vacancyId = Number(req.params.id);
  const existing = await vacancyModel.findById(vacancyId);
  if (!existing) return res.status(404).json({ error: 'Vacancy not found' });
  if (existing.status !== 'PendingApproval') {
    return res.status(422).json({ error: `Vacancy is not pending approval (current status: ${existing.status})` });
  }
  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const vacancy = await vacancyModel.update(vacancyId, {
    status: 'Open',
    approvedById: req.user.id,
    approvedAt: new Date()
  });
  res.json(vacancy);
}

async function reject(req, res) {
  const vacancyId = Number(req.params.id);
  const { reason } = req.body;
  const existing = await vacancyModel.findById(vacancyId);
  if (!existing) return res.status(404).json({ error: 'Vacancy not found' });
  if (existing.status !== 'PendingApproval') {
    return res.status(422).json({ error: `Vacancy is not pending approval (current status: ${existing.status})` });
  }
  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }
  const vacancy = await vacancyModel.update(vacancyId, {
    status: 'Rejected',
    approvedById: req.user.id,
    approvedAt: new Date(),
    rejectionReason: reason || null
  });
  res.json(vacancy);
}

async function listPublic(req, res) {
  const candidateType = req.query.candidateType;
  let where = { status: { in: ['Open', 'PartiallyFilled'] } };
  if (candidateType === 'External') {
    where.postingType = { in: ['External', 'Open'] };
  }
  const vacancies = await vacancyModel.findMany(where);
  res.json(vacancies);
}

async function listForAdmin(req, res) {
  // HR_Officer, Principal_HR_Officer and DHRA_Manager_HR are all one directorate
  // (DHRA) administering recruitment org-wide, not scoped to the vacancy's own
  // hiring department - so every staff role sees every vacancy here.
  const vacancies = await vacancyModel.findManyForAdmin({});
  res.json(vacancies);
}

async function listPendingApprovals(req, res) {
  // Approval authority is rank-based, not department-scoped, so a Principal HR
  // Officer+ must see every pending vacancy, not just ones in their own department.
  const vacancies = await vacancyModel.findManyForAdmin({ status: 'PendingApproval' });
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

module.exports = { create, approve, reject, listPublic, listForAdmin, listPendingApprovals, getOne, listApplications, saveRanking };
