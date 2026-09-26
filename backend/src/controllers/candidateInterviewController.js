const interviewModel = require('../models/interviewModel');
const { notify } = require('../services/notificationService');
const invitations = require('../services/interviewInvitationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { toCandidateInterview } = require('../utils/candidateInterview');
const { buildCalendar } = require('../utils/icsCalendar');
const { describeSlot } = require('../utils/interviewFormat');

const RESPONSES = ['Confirmed', 'RescheduleRequested'];

// A candidate may only ever see or act on their own rounds - anything else
// is a 404, not a 403, so round ids of other candidates aren't confirmed to exist.
async function loadOwnRound(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid interview id' }); return null; }
  const round = await interviewModel.findDetailed(id);
  if (!round || round.application.candidateId !== req.user.id) {
    res.status(404).json({ error: 'Interview not found' });
    return null;
  }
  return round;
}

// The candidate confirms they'll attend, or asks for another time (with a
// note saying when suits them). Asking for another time tells whoever
// scheduled the round; nothing moves until HR actually reschedules it.
async function respond(req, res) {
  const round = await loadOwnRound(req, res);
  if (!round) return;
  const { response } = req.body;
  if (!RESPONSES.includes(response)) return res.status(400).json({ error: 'response must be Confirmed or RescheduleRequested' });
  if (round.status !== 'Scheduled') return res.status(409).json({ error: 'This interview is no longer scheduled' });
  if (round.scheduledDate && new Date(round.scheduledDate) <= new Date()) {
    return res.status(422).json({ error: 'This interview has already started - please contact HR directly' });
  }
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  if (response === 'RescheduleRequested' && note.length < 5) {
    return res.status(400).json({ error: 'Please tell HR why, and which days or times would suit you' });
  }

  await interviewModel.update(round.id, {
    candidateResponse: response,
    candidateResponseNote: note || null,
    candidateRespondedAt: new Date()
  });

  if (response === 'RescheduleRequested') {
    const recipient = round.scheduledById || round.application.vacancy.createdById;
    try {
      await notify(recipient, 'InterviewRescheduleRequested', round.id,
        `${round.application.candidate.fullName} has asked to move their interview for ${round.application.vacancy.jobRef} `
        + `(${round.application.vacancy.title}, round ${round.roundNumber}, ${describeSlot(round)}). `
        + `Their note: "${note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`);
    } catch (err) {
      console.error('Could not send the reschedule-request notice:', err);
    }
  }
  broadcastDashboardEvent('InterviewUpdated', { action: 'candidateResponse', interviewId: round.id, applicationId: round.applicationId });

  const updated = await interviewModel.findById(round.id);
  res.json(toCandidateInterview(updated));
}

async function calendarFile(req, res) {
  const round = await loadOwnRound(req, res);
  if (!round) return;
  if (round.status !== 'Scheduled' || !round.scheduledDate) {
    return res.status(422).json({ error: 'This interview has no confirmed time to add to a calendar' });
  }
  const ics = buildCalendar({ events: [invitations.candidateEvent(round, round.application.vacancy.title)] });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ucaa-interview-${round.id}.ics"`);
  res.send(ics);
}

module.exports = { respond, calendarFile };
