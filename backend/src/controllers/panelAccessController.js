const { sendError } = require('../utils/errorResponse');
const panelMemberModel = require('../models/panelMemberModel');
const interviewModel = require('../models/interviewModel');
const panelAccessService = require('../services/panelAccessService');
const interviewService = require('../services/interviewService');
const { notify } = require('../services/notificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { describeSlot } = require('../utils/interviewFormat');

// HR Officer+ generates a scoped, single-use link for one panelist.
// If the panelist has an email on file it's sent directly; either way the
// link is returned so HR can share it through any other channel
// (WhatsApp, printed, read aloud) for panelists without email at all.
async function generateLink(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  const panelMember = await panelMemberModel.findById(panelMemberId);
  if (!panelMember) return res.status(404).json({ error: 'Panel member not found' });
  if (panelMember.score != null) {
    return res.status(422).json({ error: 'This panelist has already been scored' });
  }
  if (panelMember.recusedAt) {
    return res.status(422).json({ error: 'This panelist has stood down from the interview' });
  }

  // Regenerating means exactly one active link at a time - issueLink
  // revokes any previously issued, unused link for this panelist first.
  const round = await interviewModel.findDetailed(panelMember.interviewRoundId);
  if (round && round.status !== 'Scheduled') {
    return res.status(422).json({ error: 'Scoring is closed for this interview' });
  }
  const { url, emailed } = await panelAccessService.issueLink(panelMember, round);
  res.status(201).json({ url, emailed });
}

// Revokes any outstanding, unused links for a panelist - e.g. if a link
// was sent to the wrong address or a panelist should no longer score.
async function revokeAccess(req, res) {
  const panelMemberId = Number(req.params.panelMemberId);
  await panelAccessService.revokeOutstandingTokens(panelMemberId);
  res.json({ message: 'Outstanding scoring links revoked' });
}

// Public - no account, no JWT. Returns only the minimal context a panelist
// needs to score fairly: candidate name, vacancy, round details and the
// rubric. No CV, no national ID, no other applicants, no other panelists'
// scores - deliberately narrow exposure since this is a lower-trust,
// unauthenticated context.
async function viewByToken(req, res) {
  try {
    const record = await panelAccessService.validateForView(req.params.token);
    const round = record.panelMember.interviewRound;
    res.json({
      panelistName: record.panelMember.name,
      isChair: record.panelMember.isChair,
      candidateName: round.application.candidate.fullName,
      vacancyTitle: round.application.vacancy.title,
      jobRef: round.application.vacancy.jobRef,
      roundNumber: round.roundNumber,
      scheduledDate: round.scheduledDate,
      durationMinutes: round.durationMinutes,
      mode: round.mode,
      location: round.location,
      criteria: interviewService.criteriaOf(round),
      ratingScale: { min: interviewService.MIN_RATING, max: interviewService.MAX_RATING },
      expiresAt: record.expiresAt
    });
  } catch (err) {
    sendError(res, err, 410);
  }
}

// When a self-submitted score (or stand-down) completes the panel, whoever
// scheduled the round is told it's ready to finalize - HR isn't watching a
// link being used the way they are when they proxy scores in themselves.
async function tellSchedulerIfComplete(interviewRoundId) {
  try {
    const round = await interviewModel.findDetailed(interviewRoundId);
    if (!round || round.recommendation) return;
    const progress = interviewService.panelProgress(round.panelMembers);
    if (!progress.complete) return;
    const recipient = round.scheduledById || round.application.vacancy.createdById;
    if (!recipient) return;
    await notify(recipient, 'InterviewReadyToFinalize', round.id,
      `All ${progress.total} panel score${progress.total === 1 ? ' is' : 's are'} in for ${round.application.candidate.fullName} `
      + `(${round.application.vacancy.jobRef}, round ${round.roundNumber}, ${describeSlot(round)}). `
      + `Panel average: ${round.score}. The recommendation can now be finalized.`);
  } catch (err) {
    console.error('Could not send the ready-to-finalize notice:', err);
  }
}

// Public - the panelist's own submission. selfSubmitted distinguishes this
// from an HR-proxied entry in every downstream audit view. The score is
// validated BEFORE the single-use token is consumed, so a typo doesn't burn
// the panelist's only link.
async function submitByToken(req, res) {
  try {
    const record = await panelAccessService.validateForView(req.params.token);
    const { score, criterionScores } = interviewService.resolveSubmittedScore(
      record.panelMember.interviewRound, req.body
    );
    await panelAccessService.consumeForSubmit(req.params.token);

    const comments = typeof req.body.comments === 'string' ? req.body.comments.trim().slice(0, 4000) || null : null;
    await panelMemberModel.update(record.panelMemberId, {
      score, criterionScores, comments, selfSubmitted: true, submittedAt: new Date()
    });
    await interviewService.recomputeRoundScoreFor(record.panelMemberId);
    broadcastDashboardEvent('InterviewUpdated', { action: 'score', interviewId: record.panelMember.interviewRoundId });
    await tellSchedulerIfComplete(record.panelMember.interviewRoundId);

    res.json({ message: 'Score submitted. Thank you.', score });
  } catch (err) {
    sendError(res, err, 410);
  }
}

// Public - the panelist declares a conflict of interest (they know the
// candidate, say) and stands down for this one interview, using the same
// single-use link. Their place is simply left out of the panel average.
async function recuseByToken(req, res) {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
    if (reason.length < 3) return res.status(400).json({ error: 'Please say briefly why you are standing down' });
    const record = await panelAccessService.consumeForSubmit(req.params.token);
    await panelMemberModel.update(record.panelMemberId, {
      recusedAt: new Date(), recusalReason: `Declared by the panelist: ${reason}`, isChair: false
    });
    await interviewService.recomputeRoundScoreFor(record.panelMemberId);
    broadcastDashboardEvent('InterviewUpdated', { action: 'panel', interviewId: record.panelMember.interviewRoundId });
    await tellSchedulerIfComplete(record.panelMember.interviewRoundId);
    res.json({ message: 'Thank you - HR has been told you are standing down for this interview.' });
  } catch (err) {
    sendError(res, err, 410);
  }
}

module.exports = { generateLink, revokeAccess, viewByToken, submitByToken, recuseByToken };
