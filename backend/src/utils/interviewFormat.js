// Shared wording for interview times/venues in notifications and emails.
// Times are formatted in APP_TIMEZONE (default Africa/Kampala), not the
// server's own zone - the API may well run in UTC while every reader of
// these messages is in Uganda.

const DEFAULT_DURATION_MINUTES = 60;

function timeZone() {
  return process.env.APP_TIMEZONE || 'Africa/Kampala';
}

function formatWhen(date) {
  if (!date) return 'a date to be confirmed';
  try {
    return new Date(date).toLocaleString('en-GB', {
      timeZone: timeZone(), weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (err) {
    // An invalid APP_TIMEZONE must not break a notification.
    return new Date(date).toUTCString();
  }
}

function durationOf(round) {
  return round.durationMinutes || DEFAULT_DURATION_MINUTES;
}

function endOf(round) {
  return new Date(new Date(round.scheduledDate).getTime() + durationOf(round) * 60000);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "on Thu, 1 Oct 2026, 10:00 (45 min), in person at Board Room B" - the
// part of every candidate/panelist message that says when and where.
function describeSlot(round) {
  const parts = [`on ${formatWhen(round.scheduledDate)}`];
  if (round.scheduledDate) parts[0] += ` (${durationOf(round)} min)`;
  const mode = round.mode || '';
  if (mode === 'Virtual') parts.push(round.meetingLink ? `online - join at ${round.meetingLink}` : 'online (joining link to follow)');
  else if (mode === 'Phone') parts.push('by phone');
  else if (round.location) parts.push(`in person at ${round.location}`);
  else if (mode) parts.push(mode.toLowerCase());
  return parts.join(', ');
}

module.exports = { DEFAULT_DURATION_MINUTES, formatWhen, durationOf, endOf, escapeHtml, describeSlot, timeZone };
