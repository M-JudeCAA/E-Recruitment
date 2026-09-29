const { sendError } = require('../utils/errorResponse');
const panelMemberModel = require('../models/panelMemberModel');
const panelAccessService = require('../services/panelAccessService');
const panelDayLinkService = require('../services/panelDayLinkService');
const interviewService = require('../services/interviewService');
const { tellSchedulerIfComplete } = require('./panelAccessController');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { formatDay } = require('../utils/interviewFormat');

// Public - a panelist's day link (no account, no JWT). Everything is scoped
// to the one vacancy-day and the rounds where this person sits on the panel
// (panelDayLinkService). Same narrow exposure as the single-interview link:
// candidate names and interview times, the rubric, and the panelist's own
// scores - no CVs, contact details, or other panelists' scores.

function parseMemberId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function view(req, res) {
  try {
    const { link, entries, session, sessionState, closesAt } = await panelDayLinkService.load(req.params.token);
    res.json({
      panelistName: link.panelistName,
      vacancyTitle: link.vacancy.title,
      jobRef: link.vacancy.jobRef,
      day: link.day,
      dayLabel: formatDay(link.day),
      // 'notStarted' | 'running' | 'ending' (HR ended it; grace period until closesAt)
      sessionState,
      sessionStartedAt: session?.startedAt || null,
      closesAt,
      ratingScale: { min: interviewService.MIN_RATING, max: interviewService.MAX_RATING },
      candidates: entries.map((e) => ({
        panelMemberId: e.member.id,
        candidateName: e.round.application.candidate.fullName,
        roundNumber: e.round.roundNumber,
        scheduledDate: e.round.scheduledDate,
        durationMinutes: e.round.durationMinutes,
        mode: e.round.mode,
        location: e.round.location,
        isChair: e.member.isChair,
        state: panelDayLinkService.entryState(e),
        calledInAt: e.round.calledInAt || null,
        criteria: interviewService.criteriaOf(e.round),
        myScore: e.member.score
      }))
    });
  } catch (err) {
    sendError(res, err, 410);
  }
}

// One candidate's score. Validated before anything is written, so a typo
// doesn't cost the panelist their one go at this candidate.
async function score(req, res) {
  try {
    const panelMemberId = parseMemberId(req.body.panelMemberId);
    if (!panelMemberId) return res.status(400).json({ error: 'Choose the candidate you are scoring' });
    const { entry } = await panelDayLinkService.loadEntry(req.params.token, panelMemberId);
    const { score: value, criterionScores } = interviewService.resolveSubmittedScore(entry.round, req.body);
    const comments = typeof req.body.comments === 'string' ? req.body.comments.trim().slice(0, 4000) || null : null;

    const result = await panelMemberModel.updateIfOpen(panelMemberId, {
      score: value, criterionScores, comments, selfSubmitted: true, submittedAt: new Date()
    });
    if (result.count === 0) return res.status(409).json({ error: 'A score is already on record for this candidate' });
    // An older single-interview link for this panelist has nothing left to do.
    await panelAccessService.revokeOutstandingTokens(panelMemberId);
    await interviewService.recomputeRoundScoreFor(panelMemberId);
    broadcastDashboardEvent('InterviewUpdated', { action: 'score', interviewId: entry.round.id });
    await tellSchedulerIfComplete(entry.round.id);
    res.json({ message: 'Score recorded.', score: value });
  } catch (err) {
    sendError(res, err, 410);
  }
}

// The panelist declares a conflict of interest for one candidate and stands
// down from that interview only - allowed before it starts, too.
async function recuse(req, res) {
  try {
    const panelMemberId = parseMemberId(req.body.panelMemberId);
    if (!panelMemberId) return res.status(400).json({ error: 'Choose the candidate' });
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
    if (reason.length < 3) return res.status(400).json({ error: 'Please say briefly why you are standing down' });
    const { entry } = await panelDayLinkService.loadEntry(req.params.token, panelMemberId, { forRecusal: true });

    const result = await panelMemberModel.updateIfOpen(panelMemberId, {
      recusedAt: new Date(), recusalReason: `Declared by the panelist: ${reason}`, isChair: false
    });
    if (result.count === 0) return res.status(409).json({ error: 'You have already scored or stood down for this candidate' });
    await panelAccessService.revokeOutstandingTokens(panelMemberId);
    await interviewService.recomputeRoundScoreFor(panelMemberId);
    broadcastDashboardEvent('InterviewUpdated', { action: 'panel', interviewId: entry.round.id });
    await tellSchedulerIfComplete(entry.round.id);
    res.json({ message: 'HR has been told you are standing down for this interview.' });
  } catch (err) {
    sendError(res, err, 410);
  }
}

module.exports = { view, score, recuse };
