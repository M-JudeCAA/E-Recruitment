const panelMemberModel = require('../models/panelMemberModel');
const interviewModel = require('../models/interviewModel');

/**
 * Records a score/comments for one panel member, on behalf of a panelist
 * who may have no system account at all - the coordinating HR Officer
 * (recordedById) is the one submitting this, not necessarily the panelist.
 * Then recomputes the round's overall score as the average of every
 * panel member scored so far.
 */
async function recordPanelScore(panelMemberId, { score, comments }, recordedById) {
  const panelMember = await panelMemberModel.update(panelMemberId, {
    score, comments, recordedById, submittedAt: new Date()
  });
  await recomputeRoundScore(panelMember.interviewRoundId);
  return panelMember;
}

async function recomputeRoundScore(interviewRoundId) {
  const members = await panelMemberModel.findByRound(interviewRoundId);
  const scored = members.filter((m) => m.score != null);
  const average = scored.length
    ? scored.reduce((sum, m) => sum + m.score, 0) / scored.length
    : null;
  await interviewModel.update(interviewRoundId, { score: average });
}

// Used by the public token-submit path, which only has a panelMemberId on
// hand (the record was already re-fetched by that point) rather than the
// interviewRoundId directly.
async function recomputeRoundScoreFor(panelMemberId) {
  const panelMember = await panelMemberModel.findById(panelMemberId);
  await recomputeRoundScore(panelMember.interviewRoundId);
}

module.exports = { recordPanelScore, recomputeRoundScore, recomputeRoundScoreFor };
