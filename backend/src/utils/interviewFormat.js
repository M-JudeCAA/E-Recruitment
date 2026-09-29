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

// The calendar day (YYYY-MM-DD) an instant falls on in APP_TIMEZONE - an
// interview at 01:00 Kampala time is on that Kampala day, not the previous
// UTC one. Panelists' day links (panelDayLinkService) are scoped by this.
function localDay(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone(), year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// How far APP_TIMEZONE is ahead of UTC at a given instant, in ms.
function zoneOffsetMs(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone(), hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// Local midnight to the next local midnight for a YYYY-MM-DD day, as UTC
// instants: { start, end }.
function dayBounds(day) {
  const [y, m, d] = day.split('-').map(Number);
  const startOf = (dd) => {
    const guess = new Date(Date.UTC(y, m - 1, dd));
    return new Date(guess.getTime() - zoneOffsetMs(guess));
  };
  return { start: startOf(d), end: startOf(d + 1) };
}

// "Thu, 1 Oct 2026" for a YYYY-MM-DD day.
function formatDay(day) {
  const { start } = dayBounds(day);
  return start.toLocaleDateString('en-GB', { timeZone: timeZone(), weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

module.exports = {
  DEFAULT_DURATION_MINUTES, formatWhen, durationOf, endOf, escapeHtml, describeSlot, timeZone,
  localDay, dayBounds, formatDay
};
