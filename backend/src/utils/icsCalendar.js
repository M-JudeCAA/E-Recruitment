// Minimal iCalendar (RFC 5545) builder for interview invitations. No
// dependency: the handful of fields used here is small enough to write out
// directly.
//
// An emailed invitation (METHOD:REQUEST) names its ORGANIZER and the
// ATTENDEE it is addressed to, which is what makes Outlook and Google treat
// it as a meeting with Accept/Decline rather than a loose appointment. Each
// event keeps one UID for its whole life and a SEQUENCE that only ever goes
// up, so a later update (REQUEST again) or cancellation (METHOD:CANCEL)
// changes the same calendar entry instead of adding a second one.

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

// A CN parameter value: quoted, without the characters a quoted parameter
// can't hold.
function cn(name) {
  return `"${String(name || '').replace(/["\r\n]/g, '').slice(0, 120)}"`;
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

// The mailbox invitations come from, and that Accept/Decline replies go to:
// INTERVIEW_ORGANIZER_EMAIL, else the address in SMTP_FROM.
function organizer() {
  const explicit = (process.env.INTERVIEW_ORGANIZER_EMAIL || '').trim();
  const fromHeader = process.env.SMTP_FROM || '';
  const email = explicit || (fromHeader.match(/<([^>]+)>/) || [null, fromHeader.trim()])[1] || '';
  const name = (fromHeader.match(/^\s*"?([^"<]+?)"?\s*</) || [null, 'UCAA Human Resources'])[1];
  return email ? { name, email } : null;
}

/**
 * events: [{ uid, start, end, summary, description?, location?, url?,
 * sequence?, cancelled?, attendees?: [{ name, email }] }]. method is PUBLISH
 * for a file the user downloads, REQUEST/CANCEL for an emailed invitation.
 */
function buildCalendar({ method = 'PUBLISH', events }) {
  const now = formatUtc(new Date());
  const org = method === 'PUBLISH' ? null : organizer();
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
    if (org) lines.push(`ORGANIZER;CN=${cn(org.name)}:mailto:${org.email}`);
    for (const a of (method === 'PUBLISH' ? [] : e.attendees || [])) {
      if (!a.email) continue;
      lines.push(`ATTENDEE;CN=${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`);
    }
    if (!e.cancelled) lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

module.exports = { buildCalendar, interviewUid, escapeText, formatUtc, organizer };
