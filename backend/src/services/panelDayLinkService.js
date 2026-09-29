const crypto = require('crypto');
const panelDayLinkModel = require('../models/panelDayLinkModel');
const interviewDayModel = require('../models/interviewDayModel');
const interviewModel = require('../models/interviewModel');
const { samePerson } = require('./interviewSchedulingService');
const { sendMail } = require('../utils/mailer');
const { frontendUrl } = require('../config/frontendUrl');
const { AppError } = require('../utils/errorResponse');
const { localDay, dayBounds, formatDay, escapeHtml } = require('../utils/interviewFormat');

// A panelist's scoring link covers one interview day of one vacancy: every
// round of that vacancy on that day (in APP_TIMEZONE) where they sit on the
// panel. Which rounds that is gets worked out on every request from the
// rounds themselves, so a reschedule, a candidate added to the day, or a
// panel change is picked up without re-issuing anything - a round moved to
// another day simply drops off this link and onto that day's.
//
// Scoring follows the interview session HR runs for that vacancy-day
// (InterviewDay): nothing can be scored until HR starts the session, and then
// only candidates HR has called in (InterviewRound.calledInAt). The panelist
// sees the whole day's list throughout. When HR ends the session the link
// stays open for a 15-minute grace period, then closes; a session never
// ended closes at local midnight. Each candidate can be scored once, and a
// panelist can stand down for any candidate not yet scored.

const GRACE_MS = 15 * 60 * 1000;

function identityOf(link) {
  return { name: link.panelistName, email: link.panelistEmail, staffUserId: link.staffUserId };
}

function urlFor(link) {
  return `${frontendUrl}/panel-day/${link.token}`;
}

// Groups panel entries the way samePerson matches them: account, else
// email, else name.
function personKey(member) {
  if (member.staffUserId) return `u:${member.staffUserId}`;
  if (member.email) return `e:${member.email.trim().toLowerCase()}`;
  return `n:${member.name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Where a vacancy-day's session stands: 'notStarted', 'running', 'ending'
 * (ended, still in the grace period) or 'closed' (grace over, or the day
 * itself is over). session is the InterviewDay row, or null.
 */
function sessionState(session, day, now = new Date()) {
  if (now >= dayBounds(day).end && !(session?.closesAt && now < session.closesAt)) return 'closed';
  if (!session?.startedAt) return 'notStarted';
  if (!session.endedAt) return 'running';
  return now < session.closesAt ? 'ending' : 'closed';
}

// When the link stops working: the end of the grace period once HR has
// ended the session, otherwise local midnight.
function closesAtOf(session, day) {
  return session?.closesAt || dayBounds(day).end;
}

// The rounds this link covers, each with this panelist's own panel entry,
// and the session they are run under.
async function coverage(link) {
  const { start, end } = dayBounds(link.day);
  const [rounds, session] = await Promise.all([
    interviewModel.findForVacancyDay(link.vacancyId, start, end),
    interviewDayModel.find(link.vacancyId, link.day)
  ]);
  const who = identityOf(link);
  const entries = rounds
    .map((round) => ({ round, member: (round.panelMembers || []).find((m) => samePerson(who, m)) }))
    .filter((e) => e.member);
  return { entries, session, closesAt: closesAtOf(session, link.day) };
}

// Where one candidate stands for this panelist. 'waiting' covers both "the
// session hasn't started" and "not called in yet" - the page says which.
function entryState({ round, member }) {
  if (member.recusedAt) return 'recused';
  if (member.score != null) return 'scored';
  if (round.status === 'Cancelled') return 'cancelled';
  if (round.status === 'NoShow') return 'noShow';
  if (round.status !== 'Scheduled') return 'closed';
  if (!round.calledInAt) return 'waiting';
  return 'open';
}

const STATE_ERRORS = {
  recused: 'You have stood down from this interview',
  scored: 'You have already scored this candidate',
  cancelled: 'This interview was cancelled, so no score is needed',
  noShow: 'The candidate did not attend, so no score is needed',
  closed: 'The panel\'s recommendation for this interview has already been finalized',
  waiting: 'HR has not called this candidate in yet - you can score them once their interview starts'
};

/**
 * Loads a link and what it covers. Errors are AppErrors (410 Gone) so the
 * panelist sees the specific reason. Works before the session starts - the
 * page shows the day's list read-only.
 */
async function load(token) {
  const link = await panelDayLinkModel.findByToken(token);
  if (!link || link.revokedAt) throw new AppError('This scoring link is no longer valid - ask HR for the current one', 410);
  const cov = await coverage(link);
  const state = sessionState(cov.session, link.day);
  if (state === 'closed') {
    throw new AppError(`This scoring link was for interviews on ${formatDay(link.day)} and has now closed`, 410);
  }
  if (cov.entries.length === 0) throw new AppError('You are not on the panel for any interview on this link any more', 410);
  return { link, ...cov, sessionState: state };
}

// For a score or a stand-down on one candidate. Scoring needs the session
// running (or in its grace period) and the candidate called in; standing
// down (a conflict of interest) is allowed any time before they are scored.
async function loadEntry(token, panelMemberId, { forRecusal = false } = {}) {
  const ctx = await load(token);
  if (!forRecusal && ctx.sessionState === 'notStarted') {
    throw new AppError('The interview session has not started yet - HR will start it', 423);
  }
  const entry = ctx.entries.find((e) => e.member.id === panelMemberId);
  if (!entry) throw new AppError('That candidate is not on your list for this day', 404);
  const state = entryState(entry);
  if (state !== 'open' && !(forRecusal && state === 'waiting')) throw new AppError(STATE_ERRORS[state], 410);
  return { ...ctx, entry };
}

/**
 * The link for one panelist on one vacancy-day: the one already in force, or
 * a new one. fresh revokes any existing link for them first (HR reissuing
 * a lost or forwarded link), so two working links never coexist.
 */
async function ensureLink({ vacancyId, day, member, createdById = null, fresh = false }) {
  const mine = (await panelDayLinkModel.findActive(vacancyId, day)).filter((l) => samePerson(identityOf(l), member));
  if (mine.length && !fresh) return mine[0];
  if (mine.length) await panelDayLinkModel.revoke(mine.map((l) => l.id));
  return panelDayLinkModel.create({
    token: crypto.randomBytes(32).toString('hex'),
    vacancyId, day,
    panelistName: member.name,
    panelistEmail: member.email ? member.email.trim() : null,
    staffUserId: member.staffUserId || null,
    createdById
  });
}

/**
 * Makes sure every (non-recused) panelist on these rounds has a link for
 * each day they sit. rounds need interviewModel.ROUND_INCLUDE; rounds with
 * no date yet, or no longer Scheduled, are skipped. onlyMemberIds limits it
 * to some panel entries. Returns one entry per panelist per day:
 * { name, email, day, dayLabel, vacancyTitle, url, rounds }.
 */
async function linksForRounds(rounds, { createdById = null, fresh = false, onlyMemberIds = null } = {}) {
  const groups = new Map();
  for (const round of rounds) {
    if (!round.scheduledDate || round.status !== 'Scheduled') continue;
    const vacancy = round.application.vacancy;
    const day = localDay(round.scheduledDate);
    for (const member of round.panelMembers || []) {
      if (member.recusedAt || member.score != null) continue;
      if (onlyMemberIds && !onlyMemberIds.includes(member.id)) continue;
      const key = `${vacancy.id}|${day}|${personKey(member)}`;
      if (!groups.has(key)) groups.set(key, { vacancy, day, member, rounds: [] });
      groups.get(key).rounds.push(round);
    }
  }
  const results = [];
  for (const { vacancy, day, member, rounds: theirs } of groups.values()) {
    const link = await ensureLink({ vacancyId: vacancy.id, day, member, createdById, fresh });
    results.push({
      name: member.name, email: member.email ? member.email.trim() : null, staffUserId: member.staffUserId || null,
      day, dayLabel: formatDay(day), vacancyTitle: `${vacancy.jobRef} ${vacancy.title}`,
      url: urlFor(link), rounds: theirs
    });
  }
  return results;
}

// The paragraph a panelist's email carries for their day links.
function linksHtml(links) {
  return `<p>Your scoring link${links.length === 1 ? '' : 's'} - one per interview day. Each opens a page listing every candidate
you interview that day. Scoring opens when HR starts the interview session, and you can score each candidate once HR has
called them in - once per candidate. The link closes 15 minutes after HR ends the session, and at midnight at the latest.</p>
<ul>${links.map((l) => `<li>${escapeHtml(l.dayLabel)} (${escapeHtml(l.vacancyTitle)}): <a href="${l.url}">${l.url}</a></li>`).join('')}</ul>`;
}

/**
 * Emails each panelist their day link(s) on their own (the Hub's "send
 * scoring links"). Returns the results with emailed set; panelists with no
 * email keep their url for HR to pass on.
 */
async function emailLinks(results) {
  const byEmail = new Map();
  for (const r of results) {
    if (!r.email) continue;
    const key = r.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(r);
  }
  for (const [, theirs] of byEmail) {
    const info = await sendMail({
      to: theirs[0].email,
      subject: 'Interview scoring link - UCAA e-Recruitment',
      html: `<p>Dear ${escapeHtml(theirs[0].name)},</p>${linksHtml(theirs)}<p>UCAA Human Resources</p>`
    });
    theirs.forEach((r) => { r.emailed = info !== null; });
  }
  results.forEach((r) => { if (r.emailed === undefined) r.emailed = false; });
  return results;
}

// For the Hub: which panelists on this round hold a working day link, and
// until when (panel member id -> closing time).
async function activeLinksForRound(round) {
  if (!round.scheduledDate) return new Map();
  const day = localDay(round.scheduledDate);
  const [links, session] = await Promise.all([
    panelDayLinkModel.findActive(round.application.vacancy.id, day),
    interviewDayModel.find(round.application.vacancy.id, day)
  ]);
  const end = closesAtOf(session, day);
  if (sessionState(session, day) === 'closed') return new Map();
  return new Map((round.panelMembers || [])
    .filter((m) => links.some((l) => samePerson(identityOf(l), m)))
    .map((m) => [m.id, end]));
}

// Withdraws a panelist's day link for the day of this round (HR revoking
// access - a wrong address, or they should no longer score).
async function revokeForMember(member, round) {
  if (!round?.scheduledDate) return;
  const links = await panelDayLinkModel.findActive(round.application.vacancy.id, localDay(round.scheduledDate));
  const mine = links.filter((l) => samePerson(identityOf(l), member));
  if (mine.length) await panelDayLinkModel.revoke(mine.map((l) => l.id));
}

module.exports = {
  GRACE_MS, sessionState, closesAtOf, coverage, entryState, load, loadEntry, ensureLink, linksForRounds, linksHtml, emailLinks,
  activeLinksForRound, revokeForMember, urlFor
};
