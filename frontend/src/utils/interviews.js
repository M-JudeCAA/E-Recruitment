// Shared by the Interview Hub, the scheduler, the round panel, the review
// card and the candidate's My Applications - one place for how interview
// times, venues and states are worded.

export const MODES = ['In-person', 'Virtual', 'Phone'];
export const DEFAULT_DURATION = 60;
export const HIGH_SPREAD = 25; // matches backend interviewService.HIGH_SPREAD

// Ready-made scoresheets HR can start from and then edit - weights are 1-10,
// each criterion rated 1-5 by every panelist (see backend
// interviewService.scoreFromCriteria).
export const RUBRIC_TEMPLATES = [
  {
    key: 'general',
    label: 'General competency',
    criteria: [
      { name: 'Technical knowledge', weight: 3, description: 'Depth of knowledge for the role' },
      { name: 'Relevant experience', weight: 2, description: 'How well past work matches the role' },
      { name: 'Communication', weight: 2, description: 'Clarity, listening, structure of answers' },
      { name: 'Problem solving', weight: 2, description: 'Approach to the scenarios put to them' },
      { name: 'Values and conduct', weight: 1, description: 'Integrity, teamwork, professionalism' }
    ]
  },
  {
    key: 'technical',
    label: 'Technical / safety-critical',
    criteria: [
      { name: 'Regulatory knowledge', weight: 3, description: 'ICAO/UCAA regulations and standards' },
      { name: 'Technical competence', weight: 3, description: 'Hands-on skill for the role' },
      { name: 'Safety awareness', weight: 3, description: 'Judgement under safety-critical scenarios' },
      { name: 'Communication', weight: 1, description: 'Clear, standard phraseology and reporting' }
    ]
  },
  {
    key: 'leadership',
    label: 'Management / leadership',
    criteria: [
      { name: 'Strategic thinking', weight: 3, description: 'Planning and priorities' },
      { name: 'People leadership', weight: 3, description: 'Building and leading teams' },
      { name: 'Stakeholder management', weight: 2, description: 'Working across directorates and externally' },
      { name: 'Decision making', weight: 2, description: 'Sound, timely, accountable decisions' }
    ]
  }
];

export const RATING_LABELS = { 1: 'Poor', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Strong', 5: 'Outstanding' };

export function formatDateTime(value) {
  if (!value) return 'Date to be confirmed';
  return new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
}

export function formatDay(value) {
  return new Date(value).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function endOf(round) {
  if (!round.scheduledDate) return null;
  return new Date(new Date(round.scheduledDate).getTime() + (round.durationMinutes || DEFAULT_DURATION) * 60000);
}

// "10:00 - 10:45"
export function timeRange(round) {
  if (!round.scheduledDate) return 'Time to be confirmed';
  return `${formatTime(round.scheduledDate)} - ${formatTime(endOf(round))}`;
}

export function venueLabel(round) {
  if (round.mode === 'Virtual') return round.meetingLink ? 'Online' : 'Online (link to follow)';
  if (round.mode === 'Phone') return 'Phone';
  return round.location || 'Venue to be confirmed';
}

// <input type="datetime-local"> works in local wall-clock time without a
// zone; these convert to/from the ISO strings the API takes.
export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

export function isWeekend(value) {
  const day = new Date(value).getDay();
  return day === 0 || day === 6;
}

// Outside a normal 08:00-17:00 working day - the scheduler warns, it doesn't block.
export function outsideWorkingHours(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return s.getHours() < 8 || e.getHours() > 17 || (e.getHours() === 17 && e.getMinutes() > 0) || s.toDateString() !== e.toDateString();
}

export function startOfWeek(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // Monday-based
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// Saves a text/calendar response (fetched with the right client, so the
// auth header is attached) as a file.
export function saveCalendarFile(data, filename) {
  const blob = new Blob([data], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const CONFLICT_LABELS = { candidate: 'Candidate double-booked', panelist: 'Panelist double-booked', room: 'Room already booked' };

export function errorMessage(err, fallback) {
  return err?.response?.data?.error || fallback;
}
