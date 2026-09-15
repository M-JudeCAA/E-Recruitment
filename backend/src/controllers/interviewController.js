const interviewModel = require('../models/interviewModel');
const applicationModel = require('../models/applicationModel');
const panelMemberModel = require('../models/panelMemberModel');
const interviewService = require('../services/interviewService');
const { notifyCandidate } = require('../services/candidateNotificationService');

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
  const application = await applicationModel.update(applicationId, { status: 'InterviewScheduled' }, { vacancy: true });

  // Previously the candidate had no way to learn an interview was
  // scheduled short of manually checking My Applications - a real gap,
  // not just a nice-to-have, since scheduledDate can be null ("date to be
  // confirmed") and this is the only channel that tells them one exists.
  const dateLabel = round.scheduledDate
    ? new Date(round.scheduledDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'a date to be confirmed';
  await notifyCandidate(
    application.candidateId, 'InterviewScheduled',
    `An interview has been scheduled for your application to "${application.vacancy.title}" - ${dateLabel}${mode ? ` (${mode})` : ''}.`
  );

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

  // A panel recommendation of "Reject" used to leave the application
  // sitting at "Interviewed" forever with nothing but a label indicating
  // the outcome - recommendOffer's own check only required SOME
  // recommendation to be present, not specifically "Shortlist" (see the
  // comment there), so this was also a live path to recommending an offer
  // for someone the panel had explicitly rejected. Routing "Reject" here
  // through the same status/notification path as applicationController's
  // own reject() closes both at once.
  if (recommendation === 'Reject') {
    const application = await applicationModel.update(round.applicationId, {
      status: 'Rejected', rejectedAt: new Date(), rejectedById: req.user.id,
      rejectionReason: 'Not recommended for offer following the interview panel\'s review.'
    }, { vacancy: true });
    await notifyCandidate(
      application.candidateId, 'ApplicationRejected',
      `We're sorry to let you know your application for "${application.vacancy.title}" was not successful this time.`
    );
  } else {
    // Only now, once a recommendation has actually been finalized, does
    // the application move to "Interviewed".
    await applicationModel.update(round.applicationId, { status: 'Interviewed' });
  }
  res.json(round);
}

module.exports = { schedule, addPanelMember, recordPanelScore, finalizeRecommendation };
