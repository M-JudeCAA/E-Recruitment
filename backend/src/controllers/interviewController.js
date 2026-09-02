const interviewModel = require('../models/interviewModel');
const applicationModel = require('../models/applicationModel');
const panelMemberModel = require('../models/panelMemberModel');
const interviewService = require('../services/interviewService');

// Round number is computed server-side from existing rounds for this
// application, not taken from the client - avoids every round being
// labeled "Round 1" if the frontend doesn't track a running count.
async function schedule(req, res) {
  const applicationId = Number(req.params.applicationId);
  const { scheduledDate, mode, panelMembers } = req.body; // panelMembers: [{ name, trade, email }]

  const existingCount = await interviewModel.countByApplication(applicationId);
  const round = await interviewModel.create({
    applicationId,
    roundNumber: existingCount + 1,
    scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
    mode
  });

  if (Array.isArray(panelMembers) && panelMembers.length > 0) {
    await panelMemberModel.createMany(round.id, panelMembers);
  }

  // Distinct from "Interviewed" - this means an interview is upcoming,
  // not that it has happened yet.
  await applicationModel.update(applicationId, { status: 'InterviewScheduled' });
  res.status(201).json(round);
}

// Add a panelist to a round after the fact - panel composition sometimes
// isn't finalized at scheduling time.
async function addPanelMember(req, res) {
  const interviewRoundId = Number(req.params.interviewId);
  const { name, trade, email } = req.body;
  if (!name) return res.status(400).json({ error: 'Panelist name is required' });

  const panelMember = await panelMemberModel.create({ interviewRoundId, name, trade, email });
  res.status(201).json(panelMember);
}

// Proxy score entry: the coordinating HR Officer records a panelist's
// score/comments on their behalf. The panelist never needs a system
// account for this - recordedById captures who actually entered it.
async function recordPanelScore(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  const { score, comments } = req.body;

  const panelMember = await interviewService.recordPanelScore(
    panelMemberId, { score, comments }, req.user.id
  );
  res.json(panelMember);
}

// A deliberate HR judgment call, not an average - requires at least one
// panel score already on record so the recommendation is actually informed
// by panel input rather than being a bare guess.
async function finalizeRecommendation(req, res) {
  const interviewId = Number(req.params.interviewId);
  const { recommendation } = req.body;

  const panelMembers = await panelMemberModel.findByRound(interviewId);
  const hasAnyScore = panelMembers.some((m) => m.score != null);
  if (!hasAnyScore) {
    return res.status(422).json({ error: 'At least one panel member score is required before finalizing a recommendation' });
  }

  const round = await interviewModel.update(interviewId, {
    recommendation, conductedById: req.user.id
  });

  // Only now, once a recommendation has actually been finalized, does the
  // application move to "Interviewed".
  await applicationModel.update(round.applicationId, { status: 'Interviewed' });
  res.json(round);
}

module.exports = { schedule, addPanelMember, recordPanelScore, finalizeRecommendation };
