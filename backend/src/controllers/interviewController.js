const interviewModel = require('../models/interviewModel');
const applicationModel = require('../models/applicationModel');
const panelMemberModel = require('../models/panelMemberModel');
const interviewService = require('../services/interviewService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Applications an interview can legitimately be scheduled against - mirrors
// the frontend's own gate (ApplicationReviewCard.jsx: status in this list
// AND no offer yet) so a stale UI or a direct API call can't schedule a
// round on a Rejected/Offered/Withdrawn application.
const SCHEDULABLE_STATUSES = ['Shortlisted', 'InterviewScheduled', 'Interviewed'];

// Statuses an application may still validly be in when a round against it
// is finalized. Guards finalizeRecommendation below against a stale round
// (scheduled a while ago, never finalized) being resolved after the
// application already moved on elsewhere - an explicit HR reject, or an
// offer recommended off a different, later round.
const FINALIZABLE_STATUSES = ['InterviewScheduled', 'Interviewed'];

// Round number is computed server-side from existing rounds for this
// application, not taken from the client - avoids every round being
// labeled "Round 1" if the frontend doesn't track a running count.
async function schedule(req, res) {
  const applicationId = Number(req.params.applicationId);
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
  const { scheduledDate, mode, panelMembers } = req.body; // panelMembers: [{ name, trade, email }]

  const application = await applicationModel.findById(applicationId, { offer: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (!SCHEDULABLE_STATUSES.includes(application.status) || application.offer) {
    return res.status(422).json({ error: `An application at status "${application.status}" cannot have an interview scheduled` });
  }

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
  const updatedApplication = await applicationModel.update(applicationId, { status: 'InterviewScheduled' }, { vacancy: true });

  // Previously the candidate had no way to learn an interview was
  // scheduled short of manually checking My Applications - a real gap,
  // not just a nice-to-have, since scheduledDate can be null ("date to be
  // confirmed") and this is the only channel that tells them one exists.
  const dateLabel = round.scheduledDate
    ? new Date(round.scheduledDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'a date to be confirmed';
  await notifyCandidate(
    updatedApplication.candidateId, 'InterviewScheduled',
    `An interview has been scheduled for your application to "${updatedApplication.vacancy.title}" - ${dateLabel}${mode ? ` (${mode})` : ''}.`
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
// Re-scoring an already-scored panelist is deliberately still allowed (a
// legitimate correction path) - only the score's own shape is validated.
async function recordPanelScore(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  if (!Number.isInteger(panelMemberId)) return res.status(400).json({ error: 'Invalid panel member id' });
  const { score, comments } = req.body;
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
    return res.status(400).json({ error: 'score must be a number between 0 and 100' });
  }

  const existing = await panelMemberModel.findById(panelMemberId);
  if (!existing) return res.status(404).json({ error: 'Panel member not found' });

  const panelMember = await interviewService.recordPanelScore(
    panelMemberId, { score: numericScore, comments }, req.user.id
  );
  res.json(panelMember);
}

// A deliberate HR judgment call, not an average - requires at least one
// panel score already on record so the recommendation is actually informed
// by panel input rather than being a bare guess.
async function finalizeRecommendation(req, res) {
  const interviewId = Number(req.params.interviewId);
  if (!Number.isInteger(interviewId)) return res.status(400).json({ error: 'Invalid interview round id' });
  const { recommendation } = req.body;

  const panelMembers = await panelMemberModel.findByRound(interviewId);
  const hasAnyScore = panelMembers.some((m) => m.score != null);
  if (!hasAnyScore) {
    return res.status(422).json({ error: 'At least one panel member score is required before finalizing a recommendation' });
  }

  const existingRound = await interviewModel.findById(interviewId);
  if (!existingRound) return res.status(404).json({ error: 'Interview round not found' });

  // Guards against finalizing a stale round after its application already
  // moved on elsewhere since it was scheduled - an explicit HR reject, or
  // an offer recommended off a different, later round. The writes below
  // are otherwise unconditional and would silently regress a terminal/
  // later status back to Interviewed or Rejected. Read-then-write, same
  // rigor as recommendOffer's own status check just below in this file -
  // not airtight against a genuinely simultaneous race the way
  // updateIfNoRecommendation's DB-level guard is, but closes the
  // realistic window (these are minutes-to-days apart, not the same request).
  const application = await applicationModel.findById(existingRound.applicationId);
  if (!FINALIZABLE_STATUSES.includes(application.status)) {
    return res.status(409).json({
      error: `This application is at status "${application.status}" and can no longer have an interview finalized against it`
    });
  }

  // Atomic guard - scoped to recommendation: null, so a second finalize call
  // on the same round (double-click, or two HR officers racing) can't
  // silently overwrite an already-finalized recommendation.
  const guardResult = await interviewModel.updateIfNoRecommendation(interviewId, {
    recommendation, conductedById: req.user.id
  });
  if (guardResult.count === 0) {
    return res.status(409).json({ error: 'This interview round already has a finalized recommendation' });
  }
  const round = await interviewModel.findById(interviewId);

  // A panel recommendation of "Reject" used to leave the application
  // sitting at "Interviewed" forever with nothing but a label indicating
  // the outcome - recommendOffer's own check only required SOME
  // recommendation to be present, not specifically "Shortlist" (see the
  // comment there), so this was also a live path to recommending an offer
  // for someone the panel had explicitly rejected. Routing "Reject" here
  // through the same status/notification path as applicationController's
  // own reject() closes both at once.
  if (recommendation === 'Reject') {
    // rank/listStatus cleared and rankVersion bumped - same reasoning as
    // applicationController.reject(): a rejected application shouldn't
    // still show a stale shortlist rank, and the version bump means a
    // stale ranking UI still holding this id gets a 409 on its next save.
    const updatedApplication = await applicationModel.update(round.applicationId, {
      status: 'Rejected', rejectedAt: new Date(), rejectedById: req.user.id,
      rejectionReason: 'Not recommended for offer following the interview panel\'s review.',
      rank: null, listStatus: null, rankVersion: { increment: 1 }
    }, { vacancy: true });
    await notifyCandidate(
      updatedApplication.candidateId, 'ApplicationRejected',
      `We're sorry to let you know your application for "${updatedApplication.vacancy.title}" was not successful this time.`
    );
  } else {
    // Only now, once a recommendation has actually been finalized, does
    // the application move to "Interviewed".
    await applicationModel.update(round.applicationId, { status: 'Interviewed' });
  }
  broadcastDashboardEvent('InterviewRecommendation', { interviewId, applicationId: round.applicationId, recommendation });
  res.json(round);
}

module.exports = { schedule, addPanelMember, recordPanelScore, finalizeRecommendation };
