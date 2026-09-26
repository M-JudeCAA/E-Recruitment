// What a candidate may see of one of their own interview rounds. Same idea
// as utils/publicVacancy.js: every response that hands an InterviewRound to
// a candidate goes through this whitelist, so staff-only fields (the panel's
// scores and recommendation, internal notes, the rubric, who ran it) never
// reach the browser. Adding a column to InterviewRound therefore keeps it
// hidden from candidates until it is added here on purpose.
function toCandidateInterview(round) {
  if (!round) return round;
  const cancelled = round.status === 'Cancelled';
  return {
    id: round.id,
    applicationId: round.applicationId,
    roundNumber: round.roundNumber,
    scheduledDate: round.scheduledDate,
    durationMinutes: round.durationMinutes,
    mode: round.mode,
    // Venue and joining link are pointless (and a meeting link is better not
    // left lying around) once the round is off.
    location: cancelled ? null : round.location,
    meetingLink: cancelled ? null : round.meetingLink,
    instructions: cancelled ? null : round.instructions,
    // Completed is internal (it means the panel's recommendation is in);
    // to the candidate the interview has simply happened.
    status: round.status === 'Completed' ? 'Held' : round.status,
    cancellationReason: cancelled ? round.cancellationReason : null,
    candidateResponse: round.candidateResponse,
    candidateResponseNote: round.candidateResponseNote,
    candidateRespondedAt: round.candidateRespondedAt,
    rescheduleCount: round.rescheduleCount
  };
}

module.exports = { toCandidateInterview };
