const interviewModel = require('../models/interviewModel');
const { DEFAULT_DURATION_MINUTES, formatWhen } = require('../utils/interviewFormat');
const { AppError } = require('../utils/errorResponse');

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// The longest interview the clash query assumes when widening its window -
// a round longer than this that started before the window would be missed,
// which is acceptable (an 8-hour interview is not a real case).
const MAX_ASSUMED_DURATION_MINUTES = 8 * 60;
const MAX_SESSION_SIZE = 60;

function parseDate(value, field) {
  const d = new Date(value);
  if (value == null || value === '' || Number.isNaN(d.getTime())) throw new AppError(`${field} must be a valid date and time`, 400);
  return d;
}

function parseDuration(value) {
  if (value == null || value === '') return DEFAULT_DURATION_MINUTES;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 5 || n > 480) throw new AppError('durationMinutes must be a whole number from 5 to 480', 400);
  return n;
}

// Day of week in the scheduler's own time zone. tzOffsetMinutes is the
// browser's Date#getTimezoneOffset() (-180 for Kampala), so a 09:00 slot on
// a Monday in Kampala is not taken for a Sunday just because it is 06:00 UTC.
function localDay(date, tzOffsetMinutes) {
  return new Date(date.getTime() - tzOffsetMinutes * MINUTE).getUTCDay();
}

/**
 * Lays out back-to-back slots for a session: each candidate gets
 * durationMinutes, followed by gapMinutes of changeover. With maxPerDay,
 * the session carries on the next day at the same start time once a day is
 * full, skipping Saturday/Sunday unless skipWeekends is false.
 *
 * Returns [{ start, end }] - one per candidate, in order.
 */
function planSlots({ startsAt, durationMinutes, gapMinutes = 0, maxPerDay = null, skipWeekends = true, tzOffsetMinutes = 0, count }) {
  const start = parseDate(startsAt, 'startsAt');
  const duration = parseDuration(durationMinutes);
  const gap = Number(gapMinutes || 0);
  if (!Number.isInteger(gap) || gap < 0 || gap > 240) throw new AppError('gapMinutes must be a whole number from 0 to 240', 400);
  const perDay = maxPerDay == null || maxPerDay === '' ? null : Number(maxPerDay);
  if (perDay != null && (!Number.isInteger(perDay) || perDay < 1 || perDay > 50)) {
    throw new AppError('maxPerDay must be a whole number from 1 to 50', 400);
  }
  const offset = Number(tzOffsetMinutes) || 0;

  const slots = [];
  let dayStart = start;
  let cursor = start;
  let onThisDay = 0;
  for (let i = 0; i < count; i += 1) {
    if (perDay && onThisDay === perDay) {
      do {
        dayStart = new Date(dayStart.getTime() + DAY);
      } while (skipWeekends && [0, 6].includes(localDay(dayStart, offset)));
      cursor = dayStart;
      onThisDay = 0;
    }
    const end = new Date(cursor.getTime() + duration * MINUTE);
    slots.push({ start: cursor, end });
    cursor = new Date(end.getTime() + gap * MINUTE);
    onThisDay += 1;
  }
  return slots;
}

function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Two panel entries are the same person if they share a system account or
// an email; with neither on both sides, the same name is the best signal
// there is (external panelists often have no email on file).
function samePerson(a, b) {
  if (a.staffUserId && b.staffUserId) return a.staffUserId === b.staffUserId;
  if (a.email && b.email) return normalize(a.email) === normalize(b.email);
  return normalize(a.name) === normalize(b.name);
}

function roundEnd(round) {
  return new Date(new Date(round.scheduledDate).getTime() + (round.durationMinutes || DEFAULT_DURATION_MINUTES) * MINUTE);
}

function label(round) {
  return `${round.application.candidate.fullName} (${round.application.vacancy.jobRef}), ${formatWhen(round.scheduledDate)}`;
}

/**
 * Checks proposed slots against every still-Scheduled round.
 *
 * slots: [{ key, candidateId, start, end }]
 * panel: [{ name, email, staffUserId }] - the panel for these slots
 * location/mode: the venue - a room clash only counts for In-person
 * excludeRoundIds: rounds being moved (a reschedule never clashes with itself)
 *
 * Returns [{ slotKey, type: 'candidate'|'panelist'|'room', roundId, message }].
 * A clash is a warning the scheduler can override (allowConflicts) - HR may
 * know the room is big enough for two panels, or that a panelist will step
 * out - so nothing here blocks on its own.
 */
async function findConflicts({ slots, panel = [], location, mode, excludeRoundIds = [] }) {
  const timed = slots.filter((s) => s.start);
  if (timed.length === 0) return [];
  const from = new Date(Math.min(...timed.map((s) => s.start.getTime())) - MAX_ASSUMED_DURATION_MINUTES * MINUTE);
  const to = new Date(Math.max(...timed.map((s) => s.end.getTime())));
  const existing = await interviewModel.scheduledBetween(from, to, excludeRoundIds);

  const venue = mode === 'In-person' ? normalize(location) : '';
  const conflicts = [];
  for (const slot of timed) {
    for (const round of existing) {
      const rStart = new Date(round.scheduledDate);
      if (!(slot.start < roundEnd(round) && rStart < slot.end)) continue;

      if (slot.candidateId && round.application.candidateId === slot.candidateId) {
        conflicts.push({
          slotKey: slot.key, type: 'candidate', roundId: round.id,
          message: `The candidate already has an interview then: ${label(round)}`
        });
      }
      for (const p of panel) {
        const clash = round.panelMembers.find((m) => samePerson(p, m));
        if (clash) {
          conflicts.push({
            slotKey: slot.key, type: 'panelist', roundId: round.id,
            message: `${p.name} is already on the panel for ${label(round)}`
          });
        }
      }
      if (venue && round.mode === 'In-person' && normalize(round.location) === venue) {
        conflicts.push({
          slotKey: slot.key, type: 'room', roundId: round.id,
          message: `${location} is already booked for ${label(round)}`
        });
      }
    }
  }
  return conflicts;
}

/**
 * What an InterviewScheduled application should go back to once one of its
 * rounds is cancelled or marked a no-show: still InterviewScheduled if
 * another round is coming up, Interviewed if an earlier round was already
 * finalized, otherwise back to Shortlisted (ready to be scheduled again).
 */
async function statusAfterRoundClosed(applicationId, closedRoundId) {
  const rounds = await interviewModel.findByApplication(applicationId);
  const others = rounds.filter((r) => r.id !== closedRoundId);
  if (others.some((r) => r.status === 'Scheduled')) return 'InterviewScheduled';
  if (others.some((r) => r.recommendation)) return 'Interviewed';
  return 'Shortlisted';
}

module.exports = {
  MAX_SESSION_SIZE, planSlots, findConflicts, statusAfterRoundClosed, parseDate, parseDuration, samePerson
};
