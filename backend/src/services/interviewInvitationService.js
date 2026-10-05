const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');
const { buildCalendar, interviewUid } = require('../utils/icsCalendar');
const { formatWhen, durationOf, endOf, escapeHtml, describeSlot, localDay, dayBounds, formatDay } = require('../utils/interviewFormat');
const interviewModel = require('../models/interviewModel');

// Calendar invitations for interviews. Interviews are scheduled here and
// held - and scored, on paper - outside the system, so the invitation is
// what puts them in people's calendars:
//
// - Each panelist gets ONE meeting per vacancy per interview day, from their
//   first candidate to their last, with every slot listed in it - a
//   panelist on a 12-candidate session gets one calendar entry, not twelve.
//   Any change to that day (a booking, a reschedule, a cancellation, a panel
//   change) re-sends that meeting as an update; when nothing is left on the
//   day for them, it is cancelled.
// - The candidate gets a meeting for their own interview, in the same email
//   as the message telling them about it (candidateNotificationService).
//
// Both name the organizer and the attendee (utils/icsCalendar.js), so mail
// clients offer Accept/Decline, and keep one UID per meeting so updates
// replace the entry instead of adding another.

// Increases with every send, so a later update always supersedes an earlier
// one - seconds since 2026, well inside the 32-bit range calendar apps use.
function sequenceNow() {
  return Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000);
}

function venueText(round) {
  if (round.mode === 'Virtual') return round.meetingLink || 'Online';
  if (round.mode === 'Phone') return 'Phone';
  return round.location || '';
}

const emailKey = (email) => String(email || '').trim().toLowerCase();

function panelDayUid(vacancyId, day, email) {
  const who = crypto.createHash('sha1').update(emailKey(email)).digest('hex').slice(0, 16);
  return `panel-${vacancyId}-${day}-${who}@ucaa-erecruitment`;
}

// --- Single-round calendar files (downloaded, not emailed) ------------------

// One round, as a file HR downloads to forward or put in a room calendar.
function panelEvent(round, { cancelled = false } = {}) {
  const app = round.application;
  const panel = (round.panelMembers || []).map((m) => `${m.name}${m.isChair ? ' (chair)' : ''}`);
  return {
    uid: interviewUid(round.id),
    start: round.scheduledDate,
    end: endOf(round),
    sequence: round.rescheduleCount + (cancelled ? 1 : 0),
    cancelled,
    summary: `Interview panel: ${app.candidate.fullName} - ${app.vacancy.title}`,
    location: venueText(round),
    url: round.mode === 'Virtual' ? round.meetingLink : undefined,
    description: [
      `${app.vacancy.jobRef} ${app.vacancy.title}, round ${round.roundNumber}`,
      `Candidate: ${app.candidate.fullName}`,
      panel.length ? `Panel: ${panel.join(', ')}` : null
    ].filter(Boolean).join('\n')
  };
}

// The candidate's own interview. Same UID as the emailed invitation, so a
// downloaded copy and the email are one calendar entry.
function candidateEvent(round, vacancyTitle, { cancelled = false, attendee } = {}) {
  return {
    uid: interviewUid(round.id),
    start: round.scheduledDate,
    end: endOf(round),
    sequence: round.rescheduleCount + (cancelled ? 1 : 0),
    cancelled,
    summary: `Interview: ${vacancyTitle} (UCAA)`,
    location: venueText(round),
    url: round.mode === 'Virtual' ? round.meetingLink : undefined,
    description: [
      `Interview round ${round.roundNumber} for ${vacancyTitle}.`,
      round.instructions || null
    ].filter(Boolean).join('\n\n'),
    attendees: attendee ? [attendee] : []
  };
}

// The icalEvent for the candidate's email (candidateNotificationService's
// options.calendar). null when the round has no time yet.
function candidateInvitation(round, vacancyTitle, { cancelled = false } = {}) {
  if (!round.scheduledDate) return null;
  return (candidate) => {
    const method = cancelled ? 'CANCEL' : 'REQUEST';
    return {
      method,
      filename: cancelled ? 'interview-cancelled.ics' : 'interview.ics',
      content: buildCalendar({
        method,
        events: [candidateEvent(round, vacancyTitle, { cancelled, attendee: { name: candidate.fullName, email: candidate.email } })]
      })
    };
  };
}

// --- Panelists: one meeting per vacancy per day ------------------------------

const HEADINGS = {
  scheduled: { subject: 'Interview panel invitation', lead: 'You are on the interview panel on' },
  rescheduled: { subject: 'Interview panel schedule updated', lead: 'Your interview panel schedule has changed for' },
  updated: { subject: 'Interview panel schedule updated', lead: 'Your interview panel schedule has changed for' },
  cancelled: { subject: 'Interview panel schedule updated', lead: 'Your interview panel schedule has changed for' },
  removed: { subject: 'Interview panel cancelled', lead: 'You are no longer needed on the interview panel on' },
  reminder: { subject: 'Interview panel reminder', lead: 'A reminder that you are on the interview panel on' }
};

function slotRow(round, { withVacancy = false } = {}) {
  const app = round.application;
  const what = withVacancy ? `${escapeHtml(app.vacancy.title)}, round ${round.roundNumber}` : `Round ${round.roundNumber}`;
  return `<tr>
    <td style="padding:4px 12px 4px 0">${escapeHtml(formatWhen(round.scheduledDate))} (${durationOf(round)} min)</td>
    <td style="padding:4px 12px 4px 0">${escapeHtml(app.candidate.fullName)}</td>
    <td style="padding:4px 12px 4px 0">${what}</td>
    <td style="padding:4px 0">${escapeHtml(venueText(round))}</td>
  </tr>`;
}

function slotLine(round) {
  return `${formatWhen(round.scheduledDate)} (${durationOf(round)} min) - ${round.application.candidate.fullName}, round ${round.roundNumber} - ${venueText(round)}`;
}

// A panelist's rounds for one vacancy on one day: held or still to hold,
// where they are on the panel.
function panelistRounds(dayRounds, email) {
  return dayRounds
    .filter((r) => r.status !== 'Cancelled' && r.scheduledDate)
    .filter((r) => (r.panelMembers || []).some((m) => emailKey(m.email) === emailKey(email)));
}

function dayEvent({ vacancy, day, email, name, rounds }) {
  const sorted = [...rounds].sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
  const venues = [...new Set(sorted.map(venueText).filter(Boolean))];
  const link = sorted.find((r) => r.mode === 'Virtual' && r.meetingLink)?.meetingLink;
  return {
    uid: panelDayUid(vacancy.id, day, email),
    start: sorted[0].scheduledDate,
    end: new Date(Math.max(...sorted.map((r) => endOf(r).getTime()))),
    sequence: sequenceNow(),
    summary: `Interview panel: ${vacancy.title} (${sorted.length} candidate${sorted.length === 1 ? '' : 's'})`,
    location: venues.join(' / '),
    url: link,
    description: [
      `${vacancy.jobRef} ${vacancy.title} - interviews on ${formatDay(day)}`,
      '',
      ...sorted.map(slotLine),
      '',
      'Score each candidate on the panel score sheet. HR collects the signed sheet after the interviews.'
    ].join('\n'),
    attendees: [{ name, email }]
  };
}

async function sendDayInvitation({ vacancy, day, email, name, rounds, kind, reason }) {
  const cancelling = rounds.length === 0;
  const heading = cancelling ? HEADINGS.removed : (kind === 'removed' ? HEADINGS.updated : HEADINGS[kind] || HEADINGS.updated);
  const event = cancelling
    ? {
      uid: panelDayUid(vacancy.id, day, email), start: dayBounds(day).start, end: dayBounds(day).end,
      sequence: sequenceNow(), cancelled: true, summary: `Interview panel: ${vacancy.title}`, attendees: [{ name, email }]
    }
    : dayEvent({ vacancy, day, email, name, rounds });
  const method = cancelling ? 'CANCEL' : 'REQUEST';
  await sendMail({
    to: email,
    subject: `${heading.subject} - ${vacancy.title} - UCAA e-Recruitment`,
    html: `<p>Dear ${escapeHtml(name)},</p>
<p>${heading.lead} <strong>${escapeHtml(formatDay(day))}</strong> for ${escapeHtml(vacancy.jobRef)} ${escapeHtml(vacancy.title)}${cancelling ? '.' : ':'}</p>
${cancelling ? '' : `<table style="border-collapse:collapse;font-size:14px">${[...rounds].sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate)).map(slotRow).join('')}</table>`}
${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
${cancelling ? '<p>The meeting has been removed from your calendar.</p>' : '<p>The meeting invitation is attached - accept it to keep it in your calendar. Please bring or collect the panel score sheet; HR will gather the signed sheets after the interviews.</p>'}
<p>UCAA Human Resources</p>`,
    icalEvent: {
      method,
      filename: cancelling ? 'interview-panel-cancelled.ics' : 'interview-panel.ics',
      content: buildCalendar({ method, events: [event] })
    }
  });
}

/**
 * Brings panelists' calendars up to date after rounds changed. affected is
 * every round as it was before the change and as it is after (so a panelist
 * taken off, or a round moved to another day, is covered on both days).
 * Each panelist with an email gets one updated meeting per vacancy-day
 * touched - or a cancellation when nothing is left for them that day.
 * kind words the email ('scheduled', 'rescheduled', 'updated', 'cancelled');
 * only limits it to some panelists.
 * Never throws; returns how many invitations were sent.
 */
async function syncPanelInvitations(affected, kind, { reason, only } = {}) {
  // only: limit to these panelists' emails (a panel change concerns just the
  // person added, removed or re-addressed - the rest of the panel's day is
  // unchanged).
  const onlyKeys = only ? new Set(only.filter(Boolean).map(emailKey)) : null;
  const targets = new Map(); // `${vacancyId}|${day}|${email}` -> { vacancy, day, email, name }
  for (const round of affected) {
    if (!round?.scheduledDate) continue;
    const vacancy = round.application.vacancy;
    const day = localDay(round.scheduledDate);
    for (const m of round.panelMembers || []) {
      if (!m.email || (onlyKeys && !onlyKeys.has(emailKey(m.email)))) continue;
      const k = `${vacancy.id}|${day}|${emailKey(m.email)}`;
      if (!targets.has(k)) targets.set(k, { vacancy, day, email: m.email.trim(), name: m.name });
    }
  }

  const dayCache = new Map();
  let sent = 0;
  for (const target of targets.values()) {
    try {
      const cacheKey = `${target.vacancy.id}|${target.day}`;
      if (!dayCache.has(cacheKey)) {
        const { start, end } = dayBounds(target.day);
        dayCache.set(cacheKey, await interviewModel.findForVacancyDay(target.vacancy.id, start, end));
      }
      const rounds = panelistRounds(dayCache.get(cacheKey), target.email);
      await sendDayInvitation({ ...target, rounds, kind, reason });
      sent += 1;
    } catch (err) {
      console.error(`Could not send the interview panel invitation to ${target.email}:`, err.message);
    }
  }
  return sent;
}

// The day-before reminder to panelists (scripts/sendInterviewReminders.js):
// one email per panelist listing their slots - no calendar change.
async function emailPanelReminder(rounds) {
  const byEmail = new Map();
  for (const round of rounds) {
    for (const m of round.panelMembers || []) {
      if (!m.email) continue;
      const key = emailKey(m.email);
      if (!byEmail.has(key)) byEmail.set(key, { name: m.name, email: m.email.trim(), rounds: [] });
      byEmail.get(key).rounds.push(round);
    }
  }
  let sent = 0;
  for (const { name, email, rounds: theirs } of byEmail.values()) {
    const result = await sendMail({
      to: email,
      subject: 'Interview panel reminder - UCAA e-Recruitment',
      html: `<p>Dear ${escapeHtml(name)},</p>
<p>${HEADINGS.reminder.lead}:</p>
<table style="border-collapse:collapse;font-size:14px">${theirs.map((r) => slotRow(r, { withVacancy: true })).join('')}</table>
<p>Please bring the panel score sheet. HR will collect the signed sheets after the interviews.</p>
<p>UCAA Human Resources</p>`
    });
    if (result) sent += 1;
  }
  return sent;
}

// The candidate-facing sentence for each event - one place, so the in-app
// notification and the email read the same. The message ends up in an HTML
// email body (candidateNotificationService), so everything typed by staff
// is escaped.
function candidateMessage(kind, round, vacancyTitle, { reason } = {}) {
  const title = `"${escapeHtml(vacancyTitle)}"`;
  const slot = escapeHtml(describeSlot(round));
  const because = reason ? ` Reason: ${escapeHtml(reason)}.` : '';
  const calendar = round.scheduledDate ? ' A calendar invitation is attached to the email.' : '';
  switch (kind) {
    case 'scheduled':
      return `An interview (round ${round.roundNumber}) has been scheduled for your application to ${title} - ${slot}.`
        + ` Please confirm your attendance, or ask for another time, from My Applications.${calendar}`;
    case 'rescheduled':
      return `Your interview for ${title} has moved. New time: ${slot}.${because}`
        + ` Please confirm the new time from My Applications.${calendar ? ' Your calendar invitation has been updated.' : ''}`;
    case 'updated':
      return `The details of your interview for ${title} have changed: ${slot}.`
        + (round.instructions ? ` ${escapeHtml(round.instructions)}` : '')
        + ' Please check My Applications and confirm you can still attend.';
    case 'cancelled':
      return `Your interview (round ${round.roundNumber}) for ${title}, ${slot}, has been cancelled.${because}`
        + ' HR will be in touch if it is rearranged.';
    case 'reminder':
      return `Reminder: your interview for ${title} is ${slot}.`
        + (round.instructions ? ` ${escapeHtml(round.instructions)}` : '');
    default:
      throw new Error(`Unknown interview message kind: ${kind}`);
  }
}

module.exports = {
  syncPanelInvitations, emailPanelReminder, candidateMessage, candidateInvitation,
  panelEvent, candidateEvent, venueText, panelDayUid
};
