// Minimal iCalendar (RFC 5545) builder for interview invites - a panelist
// or candidate opens the .ics in Outlook/Google/Apple Calendar and gets the
// slot in their own calendar. No dependency: the handful of fields used
// here is small enough to write out directly.
//
// UIDs are stable per interview round (interviewUid), and SEQUENCE is the
// round's rescheduleCount, so a reschedule or cancellation sent later
// updates the same calendar entry instead of adding a second one.

const PRODID = '-//UCAA//e-Recruitment Interviews//EN';

function formatUtc(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets must be folded (CRLF + a single space).
// Folding by characters rather than bytes keeps this simple; 60-character
// chunks stay under the limit even for multi-byte text.
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 60) parts.push(` ${line.slice(i, i + 60)}`);
  return parts.join('\r\n');
}

function interviewUid(roundId) {
  return `interview-${roundId}@ucaa-erecruitment`;
}

/**
 * events: [{ uid, start, end, summary, description?, location?, url?,
 * sequence?, cancelled? }]. method is PUBLISH for a file the user
 * downloads, REQUEST/CANCEL for an emailed invite.
 */
function buildCalendar({ method = 'PUBLISH', events }) {
  const now = formatUtc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${PRODID}`, 'CALSCALE:GREGORIAN', `METHOD:${method}`];
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${formatUtc(e.start)}`);
    lines.push(`DTEND:${formatUtc(e.end)}`);
    lines.push(`SEQUENCE:${e.sequence || 0}`);
    lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${escapeText(e.url)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar, interviewUid, escapeText, formatUtc };
