const meritList = require('../services/meritListService');
const audit = require('../services/auditService');
const { notifyAllWithRole } = require('../services/notificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { sendError } = require('../utils/errorResponse');

// The post-interview merit list for one vacancy - see meritListService.js
// for where this sits in the selection workflow.

function parseVacancyId(req, res) {
  const id = Number(req.params.vacancyId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid vacancy id' });
    return null;
  }
  return id;
}

async function getBoard(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  try {
    res.json(await meritList.getBoard(vacancyId));
  } catch (err) {
    sendError(res, err);
  }
}

async function propose(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  const { applicationIds, applicationRankVersions } = req.body || {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0 || !applicationIds.every(Number.isInteger)) {
    return res.status(400).json({ error: 'applicationIds must be a non-empty array of application ids' });
  }
  if (new Set(applicationIds).size !== applicationIds.length) {
    return res.status(400).json({ error: 'applicationIds contains a duplicate application id' });
  }
  if (typeof applicationRankVersions !== 'object' || applicationRankVersions === null
    || !Object.values(applicationRankVersions).every(Number.isInteger)) {
    return res.status(400).json({ error: 'applicationRankVersions must map application ids to integer rankVersions' });
  }

  let result;
  try {
    result = await meritList.propose(vacancyId, applicationIds, applicationRankVersions, req.user.id);
  } catch (err) {
    return sendError(res, err);
  }

  await audit.record({
    entityType: 'Vacancy', entityId: vacancyId, action: 'Merit list proposed', actor: audit.actorFrom(req),
    details: { applicationIds, primaryCount: result.primaryCount, reserveCount: result.reserveCount }
  });

  // The proposal is already committed - a notification failure must not
  // turn it into a 500.
  try {
    const { vacancy, primaryCount, reserveCount } = result;
    await notifyAllWithRole('Principal_HR_Officer', 'MeritListProposed', vacancyId,
      `A merit list for ${vacancy.jobRef} (${vacancy.title}) is awaiting approval: `
      + `${primaryCount} recommended for appointment, ${reserveCount} on reserve.`);
  } catch (err) {
    console.error(`Failed to notify approvers of the merit list for vacancy ${vacancyId}:`, err);
  }
  broadcastDashboardEvent('MeritListProposed', { vacancyId });
  res.json({ message: 'Merit list proposed', vacancyId, primaryCount: result.primaryCount, reserveCount: result.reserveCount });
}

async function approve(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  try {
    const result = await meritList.approve(vacancyId, req.user.id);
    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action: 'Merit list approved', actor: audit.actorFrom(req), details: result
    });
    broadcastDashboardEvent('MeritListApproved', { vacancyId });
    res.json({ message: 'Merit list approved', vacancyId, ...result });
  } catch (err) {
    sendError(res, err);
  }
}

async function listPendingApproval(req, res) {
  res.json(await meritList.listPendingApproval());
}

module.exports = { getBoard, propose, approve, listPendingApproval };
