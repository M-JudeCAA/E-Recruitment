const { sendMail } = require('../utils/mailer');
const { buildCalendar, interviewUid } = require('../utils/icsCalendar');
const { formatWhen, durationOf, endOf, escapeHtml, describeSlot } = require('../utils/interviewFormat');

// Panelists usually have no system account, so email (with a calendar
// invite attached) is how they learn they are on a panel, and when. One
// email per panelist per action, listing every slot they sit on - a
// panelist on a 12-candidate session gets one message, not twelve.

function venueText(round) {
  if (round.mode === 'Virtual') return round.meetingLink || 'Online';
  if (round.mode === 'Phone') return 'Phone';
  return round.location || '';
}

function panelEvent(round, { cancelled = false } = {}) {
  const app = round.application;
  const panel = (round.panelMembers || []).filter((m) => !m.recusedAt).map((m) => `${m.name}${m.isChair ? ' (chair)' : ''}`);
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

function candidateEvent(round, vacancyTitle) {
  return {
    uid: interviewUid(round.id),
    start: round.scheduledDate,
    end: endOf(round),
    sequence: round.rescheduleCount,
    summary: `Interview: ${vacancyTitle} (UCAA)`,
    location: venueText(round),
    url: round.mode === 'Virtual' ? round.meetingLink : undefined,
    description: [
      `Interview round ${round.roundNumber} for ${vacancyTitle}.`,
      round.instructions || null
    ].filter(Boolean).join('\n\n')
  };
}

const HEADINGS = {
  scheduled: { subject: 'Interview panel invitation', lead: 'You are on the interview panel for the following:' },
  rescheduled: { subject: 'Interview panel rescheduled', lead: 'The following interview has moved to a new time:' },
  cancelled: { subject: 'Interview panel cancelled', lead: 'The following interview has been cancelled:' },
  reminder: { subject: 'Interview panel reminder', lead: 'A reminder that you are on the interview panel for:' }
};

function slotRow(round) {
  const app = round.application;
  return `<tr>
    <td style="padding:4px 12px 4px 0">${escapeHtml(formatWhen(round.scheduledDate))} (${durationOf(round)} min)</td>
    <td style="padding:4px 12px 4px 0">${escapeHtml(app.candidate.fullName)}</td>
    <td style="padding:4px 12px 4px 0">${escapeHtml(app.vacancy.jobRef)} ${escapeHtml(app.vacancy.title)} &middot; round ${round.roundNumber}</td>
    <td style="padding:4px 0">${escapeHtml(venueText(round))}</td>
  </tr>`;
}

/**
 * Emails every (non-recused) panelist with an address about the given
 * rounds. kind: 'scheduled' | 'rescheduled' | 'cancelled'. rounds must be
 * loaded with interviewModel.ROUND_INCLUDE. Never throws - an email problem
 * must not undo the scheduling action that triggered it (sendMail itself
 * already returns null on failure). Returns how many panelists were emailed.
 */
async function emailPanel(rounds, kind, { reason } = {}) {
  const byEmail = new Map();
  for (const round of rounds) {
    if (!round.scheduledDate) continue;
    for (const m of round.panelMembers || []) {
      if (!m.email || m.recusedAt) continue;
      const key = m.email.trim().toLowerCase();
      if (!byEmail.has(key)) byEmail.set(key, { name: m.name, email: m.email.trim(), rounds: [] });
      byEmail.get(key).rounds.push(round);
    }
  }

  const heading = HEADINGS[kind];
  const cancelled = kind === 'cancelled';
  let sent = 0;
  for (const { name, email, rounds: theirs } of byEmail.values()) {
    const ics = buildCalendar({
      method: cancelled ? 'CANCEL' : 'REQUEST',
      events: theirs.map((r) => panelEvent(r, { cancelled }))
    });
    try {
      await sendMail({
        to: email,
        subject: `${heading.subject} - UCAA e-Recruitment`,
        html: `<p>Dear ${escapeHtml(name)},</p>
<p>${heading.lead}</p>
<table style="border-collapse:collapse;font-size:14px">${theirs.map(slotRow).join('')}</table>
${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
${cancelled ? '' : '<p>A calendar invite is attached. HR will send you a separate, single-use link to submit your scores.</p>'}
<p>UCAA Human Resources</p>`,
        attachments: [{
          filename: cancelled ? 'interview-cancelled.ics' : 'interview.ics',
          content: ics,
          contentType: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'REQUEST'}`
        }]
      });
      sent += 1;
    } catch (err) {
      console.error(`Could not email interview panelist ${email}:`, err.message);
    }
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
  switch (kind) {
    case 'scheduled':
      return `An interview (round ${round.roundNumber}) has been scheduled for your application to ${title} - ${slot}.`
        + ' Please confirm your attendance, or ask for another time, from My Applications.';
    case 'rescheduled':
      return `Your interview for ${title} has moved. New time: ${slot}.${because}`
        + ' Please confirm the new time from My Applications.';
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

module.exports = { emailPanel, candidateMessage, panelEvent, candidateEvent, venueText };
