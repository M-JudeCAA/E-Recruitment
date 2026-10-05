const conflictOfInterest = require('../services/conflictOfInterestService');
const crypto = require('crypto');
const fs = require('fs');
const prisma = require('../config/db');
const auditService = require('../services/auditService');
const interviewModel = require('../models/interviewModel');
const applicationModel = require('../models/applicationModel');
const panelMemberModel = require('../models/panelMemberModel');
const vacancyModel = require('../models/vacancyModel');
const scheduling = require('../services/interviewSchedulingService');
const invitations = require('../services/interviewInvitationService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { AppError, sendError } = require('../utils/errorResponse');
const { validateEmail } = require('../utils/validators');
const { buildCalendar } = require('../utils/icsCalendar');
const { endOf } = require('../utils/interviewFormat');
const { fileUrl } = require('../middleware/upload');
const { CLEARED_MERIT } = require('../services/meritListService');

// Interviews are scheduled here and held outside the system: the panel
// scores each candidate on a paper score sheet, and HR records what it
// decided afterwards (recordResults) - the overall score, the verdict and
// the signed sheet. Calendar invitations (interviewInvitationService) put
// the interviews in the panelists' and the candidate's calendars.

// Applications an interview can legitimately be scheduled against - mirrors
// the frontend's own gate (status in this list AND no offer yet) so a stale
// UI or a direct API call can't schedule a round on a Rejected/Offered/
// Withdrawn application.
const SCHEDULABLE_STATUSES = ['Shortlisted', 'InterviewScheduled', 'Interviewed'];

// Statuses an application may still validly be in when a round's results
// are recorded. Guards recordResults against a stale round (scheduled a
// while ago, never recorded) being resolved after the application already
// moved on elsewhere - an explicit HR reject, or an offer recommended off a
// different, later round.
const FINALIZABLE_STATUSES = ['InterviewScheduled', 'Interviewed'];

const MODES = ['In-person', 'Virtual', 'Phone'];
const RECOMMENDATIONS = ['Shortlist', 'Hold', 'Reject'];
const MAX_PANEL_SIZE = 15;
// "Unconfirmed" in the Hub means the candidate hasn't answered and the
// interview is this close.
const UNCONFIRMED_WINDOW_MS = 72 * 60 * 60 * 1000;

// Every handler reports a thrown AppError (bad input, found by the shared
// parsers below) as its own status and message; anything else is a logged 500.
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    // An AppError's code (EXCO_APPROVAL_REQUIRED, ...) is what the frontend acts on.
    if (err?.isAppError && err.code) return res.status(err.status).json({ error: err.message, code: err.code });
    sendError(res, err);
  }
};

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function cleanText(value, max = 2000) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

// The when/where of a round, from a request body. Only fields actually
// present are returned when partial is set (PATCH), so an edit that leaves
// the venue alone doesn't wipe it.
function parseLogistics(body, { partial = false } = {}) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(body, k);

  if (has('scheduledDate')) {
    out.scheduledDate = body.scheduledDate ? scheduling.parseDate(body.scheduledDate, 'scheduledDate') : null;
  }
  if (has('durationMinutes')) out.durationMinutes = scheduling.parseDuration(body.durationMinutes);
  if (has('mode')) {
    // Older clients sent free text ("In person", "online") - accepted and
    // stored in the canonical spelling the clash check and emails rely on.
    const key = String(body.mode || 'In-person').trim().toLowerCase().replace(/[\s_-]+/g, '');
    const mode = MODES.find((m) => m.toLowerCase().replace('-', '') === key)
      || { online: 'Virtual', video: 'Virtual', telephone: 'Phone', inperson: 'In-person' }[key];
    if (!mode) throw new AppError(`mode must be one of ${MODES.join(', ')}`, 400);
    out.mode = mode;
  }
  if (has('location')) out.location = cleanText(body.location, 191);
  if (has('meetingLink')) {
    const link = cleanText(body.meetingLink, 1000);
    // Rendered as a clickable link for candidates and panelists - only
    // real web addresses, never javascript: or similar.
    if (link && !/^https?:\/\/\S+$/i.test(link)) throw new AppError('meetingLink must be a web address starting with http:// or https://', 400);
    out.meetingLink = link;
  }
  if (has('instructions')) out.instructions = cleanText(body.instructions);
  if (has('internalNotes')) out.internalNotes = cleanText(body.internalNotes);
  return out;
}

function parsePanelist(p) {
  const name = cleanText(p?.name, 191);
  if (!name) throw new AppError('Every panelist needs a name', 400);
  const email = cleanText(p.email, 191);
  if (email && !validateEmail(email)) throw new AppError(`"${email}" is not a valid email address`, 400);
  return {
    name,
    trade: cleanText(p.trade, 191),
    email,
    staffUserId: parseId(p.staffUserId),
    isChair: !!p.isChair
  };
}

function parsePanel(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new AppError('panelMembers must be a list', 400);
  const panel = list.filter((p) => cleanText(p?.name)).map(parsePanelist);
  if (panel.length > MAX_PANEL_SIZE) throw new AppError(`A panel can have at most ${MAX_PANEL_SIZE} members`, 400);
  if (panel.filter((p) => p.isChair).length > 1) throw new AppError('Only one panelist can chair the panel', 400);
  for (let i = 0; i < panel.length; i += 1) {
    for (let j = i + 1; j < panel.length; j += 1) {
      if (scheduling.samePerson(panel[i], panel[j])) throw new AppError(`${panel[i].name} is on the panel twice`, 400);
    }
  }
  return panel;
}

// The shape every Hub endpoint returns for a round: resultsDue marks an
// interview whose time has come with no results recorded yet.
function decorate(round) {
  return {
    ...round,
    resultsDue: round.status === 'Scheduled' && !!round.scheduledDate && new Date(round.scheduledDate) <= new Date()
  };
}

async function audit(entityId, action, performedById, payload) {
  await prisma.auditLog.create({ data: { entityType: 'InterviewRound', entityId, action, performedById, payload } });
}

// Notifications are a side effect of an action that already committed - a
// failure here must never turn the response into a 500. options.calendar
// attaches the candidate's calendar invitation to the email.
async function notifyCandidateSafely(candidateId, type, message, options) {
  try {
    await notifyCandidate(candidateId, type, message, options);
  } catch (err) {
    console.error(`Failed to send ${type} candidate notification:`, err);
  }
}

// Brings the panelists' calendar invitations up to date (see
// interviewInvitationService.syncPanelInvitations). Returns how many were
// sent; never throws.
async function syncPanelSafely(affected, kind, options) {
  try {
    return await invitations.syncPanelInvitations(affected, kind, options);
  } catch (err) {
    console.error(`Failed to update interview panel invitations (${kind}):`, err);
    return 0;
  }
}

function broadcast(action, round) {
  broadcastDashboardEvent('InterviewUpdated', { action, interviewId: round.id, applicationId: round.applicationId });
}

async function loadRoundOr404(req, res) {
  const id = parseId(req.params.interviewId);
  if (!id) { res.status(400).json({ error: 'Invalid interview round id' }); return null; }
  const round = await interviewModel.findDetailed(id);
  if (!round) { res.status(404).json({ error: 'Interview round not found' }); return null; }
  return round;
}

function requireScheduled(round, res, verb) {
  if (round.status !== 'Scheduled') {
    res.status(409).json({ error: `This interview is ${round.status === 'NoShow' ? 'marked as a no-show' : round.status.toLowerCase()} and can no longer be ${verb}` });
    return false;
  }
  return true;
}

function conflictResponse(res, conflicts) {
  return res.status(409).json({
    error: 'This clashes with other interviews. Review the clashes, or schedule anyway.',
    code: 'SCHEDULE_CONFLICT',
    conflicts
  });
}

function notSchedulableResponse(res, err) {
  return res.status(409).json({ error: `${err.message} - it was updated by someone else. Refresh and try again.` });
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

// EXCO approves the interview shortlist outside the system; a candidate's
// first interview waits for HR to attach the signed approval
// (excoShortlistController). Rounds booked before that step existed, and
// later rounds, don't need it again.
const needsExcoApproval = (application, roundCount) => !application.excoApprovalId && roundCount === 0;

function excoApprovalError(names) {
  const err = new AppError(`Waiting for EXCO's approval of the shortlist: ${names.join(', ')}. Print the approved shortlist for EXCO and attach the signed copy first.`, 409);
  err.code = 'EXCO_APPROVAL_REQUIRED';
  return err;
}

// One interview for one application (the review card's "Schedule interview").
// Round number is computed server-side from existing rounds for this
// application, not taken from the client.
async function schedule(req, res) {
  const applicationId = parseId(req.params.applicationId);
  if (!applicationId) return res.status(400).json({ error: 'Invalid application id' });

  const application = await applicationModel.findById(applicationId, { offer: true, vacancy: true, candidate: { select: { fullName: true } } });
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (!SCHEDULABLE_STATUSES.includes(application.status) || application.offer) {
    return res.status(422).json({ error: `An application at status "${application.status}" cannot have an interview scheduled` });
  }
  // A candidate already ranked on the merit list has been decided on - a
  // further round would change the result the list was built from. HR
  // takes them off the list (re-propose without them) first.
  if (application.meritStatus) {
    return res.status(422).json({ error: 'This candidate is already on the merit list - take them off it before scheduling another round' });
  }
  if (needsExcoApproval(application, await interviewModel.countByApplication(applicationId))) {
    const err = excoApprovalError([application.candidate?.fullName || 'this candidate']);
    return res.status(409).json({ error: err.message, code: err.code });
  }

  const logistics = parseLogistics(req.body);
  const panel = parsePanel(req.body.panelMembers);

  if (logistics.scheduledDate && !req.body.allowConflicts) {
    const conflicts = await scheduling.findConflicts({
      slots: [{ key: applicationId, candidateId: application.candidateId, start: logistics.scheduledDate, end: endOf(logistics) }],
      panel, location: logistics.location, mode: logistics.mode
    });
    if (conflicts.length) return conflictResponse(res, conflicts);
  }

  let created;
  try {
    [created] = await interviewModel.createSession([{
      round: { applicationId, ...logistics, scheduledById: req.user.id },
      panel
    }], SCHEDULABLE_STATUSES);
  } catch (err) {
    if (err.code === 'NOT_SCHEDULABLE') return notSchedulableResponse(res, err);
    throw err;
  }

  const [round] = await interviewModel.findManyDetailed([created.id]);
  // The candidate's only channel for learning an interview exists (and
  // where/when it is) - scheduledDate can still be null ("to be confirmed"),
  // in which case there is no calendar invitation yet.
  await notifyCandidateSafely(application.candidateId, 'InterviewScheduled',
    invitations.candidateMessage('scheduled', round, application.vacancy.title),
    { calendar: invitations.candidateInvitation(round, application.vacancy.title) });
  const panelEmailed = req.body.notifyPanel === false ? 0 : await syncPanelSafely([round], 'scheduled');

  broadcast('scheduled', round);
  res.status(201).json({ ...decorate(round), panelEmailed });
}

// Shared by the session preview and the session create: validates the
// request, lays the candidates out in back-to-back slots and checks every
// slot for clashes.
async function buildSession(req) {
  const vacancyId = parseId(req.params.vacancyId);
  if (!vacancyId) throw new AppError('Invalid vacancy id', 400);
  const { applicationIds } = req.body;
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    throw new AppError('Choose at least one candidate', 400);
  }
  const ids = applicationIds.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new AppError('Invalid application id in the list', 400);
  if (new Set(ids).size !== ids.length) throw new AppError('A candidate appears twice in the list', 400);
  if (ids.length > scheduling.MAX_SESSION_SIZE) {
    throw new AppError(`A session can have at most ${scheduling.MAX_SESSION_SIZE} candidates - split it into two`, 400);
  }

  const apps = await applicationModel.findForSession(vacancyId, ids);
  if (apps.length !== ids.length) throw new AppError('Some of these applications were not found on this vacancy', 404);
  const blocked = apps.filter((a) => !SCHEDULABLE_STATUSES.includes(a.status) || a.offer || a.meritStatus);
  if (blocked.length) {
    throw new AppError(`Not schedulable: ${blocked.map((a) => `${a.candidate.fullName} (${a.meritStatus ? 'on the merit list' : a.status})`).join(', ')}`, 422);
  }
  const unapproved = apps.filter((a) => needsExcoApproval(a, a._count?.interviewRounds ?? 0));
  if (unapproved.length) throw excoApprovalError(unapproved.map((a) => a.candidate.fullName));

  const logistics = parseLogistics({ ...req.body, scheduledDate: undefined });
  delete logistics.scheduledDate;
  const panel = parsePanel(req.body.panelMembers);
  const slots = scheduling.planSlots({
    startsAt: req.body.startsAt,
    durationMinutes: logistics.durationMinutes,
    gapMinutes: req.body.gapMinutes,
    maxPerDay: req.body.maxPerDay,
    skipWeekends: req.body.skipWeekends !== false,
    tzOffsetMinutes: req.body.tzOffsetMinutes,
    count: ids.length
  });

  const byId = new Map(apps.map((a) => [a.id, a]));
  const ordered = ids.map((id, i) => ({ application: byId.get(id), start: slots[i].start, end: slots[i].end }));
  const conflicts = await scheduling.findConflicts({
    slots: ordered.map((o) => ({ key: o.application.id, candidateId: o.application.candidateId, start: o.start, end: o.end })),
    panel, location: logistics.location, mode: logistics.mode
  });
  return { vacancyId, ordered, conflicts, logistics, panel };
}

function describeSession({ ordered, conflicts }) {
  return {
    slots: ordered.map((o) => ({
      applicationId: o.application.id,
      candidateName: o.application.candidate.fullName,
      start: o.start,
      end: o.end,
      conflicts: conflicts.filter((c) => c.slotKey === o.application.id)
    })),
    conflicts,
    startsAt: ordered[0].start,
    endsAt: ordered[ordered.length - 1].end
  };
}

// Dry run of a bulk session - the scheduler's review step, so HR sees every
// slot and every clash before anything is booked or anyone is emailed.
async function planSession(req, res) {
  const session = await buildSession(req);
  res.json(describeSession(session));
}

// Books a whole interview session for one vacancy in one go: back-to-back
// slots for every chosen candidate, one shared panel, one transaction.
// Candidates each get an invitation for their own slot; each panelist gets
// one calendar meeting per day covering all their slots.
async function scheduleSession(req, res) {
  const session = await buildSession(req);
  if (session.conflicts.length && !req.body.allowConflicts) {
    return res.status(409).json({
      error: 'Some slots clash with other interviews. Review the clashes, or schedule anyway.',
      code: 'SCHEDULE_CONFLICT',
      ...describeSession(session)
    });
  }

  const sessionKey = `s_${crypto.randomBytes(6).toString('hex')}`;
  let created;
  try {
    created = await interviewModel.createSession(session.ordered.map((o) => ({
      round: {
        applicationId: o.application.id,
        ...session.logistics,
        scheduledDate: o.start,
        sessionKey,
        scheduledById: req.user.id
      },
      panel: session.panel
    })), SCHEDULABLE_STATUSES);
  } catch (err) {
    if (err.code === 'NOT_SCHEDULABLE') return notSchedulableResponse(res, err);
    throw err;
  }

  const rounds = await interviewModel.findManyDetailed(created.map((r) => r.id));
  for (const round of rounds) {
    await notifyCandidateSafely(round.application.candidateId, 'InterviewScheduled',
      invitations.candidateMessage('scheduled', round, round.application.vacancy.title),
      { calendar: invitations.candidateInvitation(round, round.application.vacancy.title) });
  }
  const panelEmailed = req.body.notifyPanel === false ? 0 : await syncPanelSafely(rounds, 'scheduled');

  await prisma.auditLog.create({
    data: {
      entityType: 'Vacancy', entityId: session.vacancyId, action: 'Interview session scheduled', performedById: req.user.id,
      payload: { sessionKey, roundIds: rounds.map((r) => r.id), overrodeConflicts: session.conflicts.length > 0 }
    }
  });
  broadcastDashboardEvent('InterviewUpdated', { action: 'session', sessionKey, vacancyId: session.vacancyId });
  res.status(201).json({ sessionKey, rounds: rounds.map((r) => decorate(r)), panelEmailed });
}

// What the scheduler needs to open on a vacancy: who can be scheduled, the
// panelists used on it before (one click to reuse), and the logistics of
// the last round as sensible defaults.
async function schedulingContext(req, res) {
  const vacancyId = parseId(req.params.vacancyId);
  if (!vacancyId) return res.status(400).json({ error: 'Invalid vacancy id' });
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const [applications, usedPanelists, rounds] = await Promise.all([
    applicationModel.findSchedulable(vacancyId, SCHEDULABLE_STATUSES),
    panelMemberModel.findUsedOnVacancy(vacancyId),
    interviewModel.findByVacancy(vacancyId)
  ]);

  const previousPanelists = [];
  for (const p of usedPanelists) {
    if (!previousPanelists.some((q) => scheduling.samePerson(p, q))) previousPanelists.push({ ...p, isChair: false });
  }
  const latest = rounds.find((r) => r.status !== 'Cancelled') || null;

  res.json({
    vacancy: { id: vacancy.id, jobRef: vacancy.jobRef, title: vacancy.title, positionsRequired: vacancy.positionsRequired },
    applications,
    previousPanelists,
    lastLogistics: latest
      ? { durationMinutes: latest.durationMinutes, mode: latest.mode, location: latest.location, meetingLink: latest.meetingLink, instructions: latest.instructions }
      : null
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function parseDateParam(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const ROUND_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'NoShow'];

// The Hub's agenda: rounds in a date window, optionally for one vacancy /
// in given statuses / matching a candidate name.
async function list(req, res) {
  const status = typeof req.query.status === 'string'
    ? req.query.status.split(',').filter((s) => ROUND_STATUSES.includes(s))
    : undefined;
  const conflicted = await conflictOfInterest.conflictedVacancyIds(req);
  const rounds = await interviewModel.list({
    from: parseDateParam(req.query.from),
    to: parseDateParam(req.query.to),
    vacancyId: parseId(req.query.vacancyId) || undefined,
    status: status && status.length ? status : undefined,
    search: cleanText(req.query.search, 100) || undefined,
    sessionKey: cleanText(req.query.sessionKey, 40) || undefined
  });
  // Never the interviews of a vacancy the viewer applied for.
  res.json(rounds.filter((r) => !conflicted.includes(r.application?.vacancy?.id)).map((r) => decorate(r)));
}

// Everything in the interview pipeline that is waiting on somebody, bucketed
// so the Hub can show HR what to do next rather than just what exists.
async function attention(req, res) {
  const now = new Date();
  const [openAll, shortlistedAll, conflicted] = await Promise.all([
    interviewModel.openRounds(),
    applicationModel.findShortlistedUnscheduled(),
    conflictOfInterest.conflictedVacancyIds(req)
  ]);
  // Never a vacancy the viewer applied for.
  const open = openAll.filter((r) => !conflicted.includes(r.application?.vacancy?.id));
  const shortlisted = shortlistedAll.filter((a) => !conflicted.includes(a.vacancy?.id));
  const rounds = open.map((r) => decorate(r));
  const past = (r) => r.scheduledDate && new Date(r.scheduledDate) <= now;

  const waiting = new Map();
  for (const a of shortlisted) {
    const entry = waiting.get(a.vacancy.id) || { ...a.vacancy, count: 0 };
    entry.count += 1;
    waiting.set(a.vacancy.id, entry);
  }

  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  res.json({
    rescheduleRequests: rounds.filter((r) => r.candidateResponse === 'RescheduleRequested'),
    // Held, but the panel's results aren't recorded yet.
    awaitingResults: rounds.filter((r) => past(r)),
    unconfirmed: rounds.filter((r) => r.scheduledDate && !past(r) && r.candidateResponse === 'Pending'
      && new Date(r.scheduledDate) - now <= UNCONFIRMED_WINDOW_MS),
    noDate: rounds.filter((r) => !r.scheduledDate),
    noPanel: rounds.filter((r) => (r.panelMembers || []).length === 0),
    awaitingScheduling: [...waiting.values()].sort((a, b) => b.count - a.count),
    counts: {
      today: rounds.filter((r) => r.scheduledDate && new Date(r.scheduledDate) >= startOfDay && new Date(r.scheduledDate) < endOfDay).length,
      next7Days: rounds.filter((r) => r.scheduledDate && new Date(r.scheduledDate) >= now && new Date(r.scheduledDate) <= endOfWeek).length,
      open: rounds.length,
      confirmed: rounds.filter((r) => r.candidateResponse === 'Confirmed' && !past(r)).length
    }
  });
}

async function getById(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  const siblings = await interviewModel.findByApplication(round.applicationId);
  res.json({
    ...decorate(round),
    otherRounds: siblings
      .filter((r) => r.id !== round.id)
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map(({ id, roundNumber, status, scheduledDate, score, recommendation }) => ({ id, roundNumber, status, scheduledDate, score, recommendation }))
  });
}

// Side-by-side comparison of every candidate interviewed for a vacancy -
// latest held round per candidate, with the panel's score and verdict and
// whether the signed score sheet is attached. Sorted best score first.
async function scorecard(req, res) {
  const vacancyId = parseId(req.params.vacancyId);
  if (!vacancyId) return res.status(400).json({ error: 'Invalid vacancy id' });
  const rounds = await interviewModel.findByVacancy(vacancyId);

  const byApplication = new Map();
  for (const r of rounds) {
    if (!byApplication.has(r.applicationId)) byApplication.set(r.applicationId, []);
    byApplication.get(r.applicationId).push(r);
  }
  const rows = [...byApplication.values()].map((appRounds) => {
    const held = appRounds.filter((r) => !['Cancelled', 'NoShow'].includes(r.status)).sort((a, b) => b.roundNumber - a.roundNumber);
    const latest = held[0] || appRounds.sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const d = decorate(latest);
    const app = latest.application;
    return {
      applicationId: app.id,
      candidateName: app.candidate.fullName,
      candidateType: app.candidate.candidateType,
      applicationStatus: app.status,
      listStatus: app.listStatus,
      rank: app.rank,
      meritRank: app.meritRank,
      meritListStatus: app.meritListStatus,
      meritStatus: app.meritStatus,
      offerStatus: app.offer?.status || null,
      rounds: appRounds.length,
      noShows: appRounds.filter((r) => r.status === 'NoShow').length,
      latestRound: {
        id: d.id, roundNumber: d.roundNumber, status: d.status, scheduledDate: d.scheduledDate,
        score: d.score, recommendation: d.recommendation, resultsDue: d.resultsDue,
        scoreSheetUrl: d.scoreSheetUrl, scoreSheetName: d.scoreSheetName
      }
    };
  });
  rows.sort((a, b) => (b.latestRound.score ?? -1) - (a.latestRound.score ?? -1));
  res.json(rows);
}

// A calendar file for one round (panel view) - HR downloads it to forward
// or to put in a shared room calendar.
async function calendarFile(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!round.scheduledDate) return res.status(422).json({ error: 'This interview has no date yet' });
  const ics = buildCalendar({
    events: [invitations.panelEvent(round, { cancelled: round.status === 'Cancelled' })]
  });
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="interview-${round.id}.ics"`);
  res.send(ics);
}

// ---------------------------------------------------------------------------
// Changing a round
// ---------------------------------------------------------------------------

// Edits details other than the time (use reschedule for that). A change
// the candidate/panel would care about (venue, link, length, mode) tells
// them and updates their calendar invitations, unless notifyParticipants is
// false.
async function update(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'edited')) return;

  const changes = parseLogistics(req.body, { partial: true });
  delete changes.scheduledDate;
  if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const visible = ['durationMinutes', 'mode', 'location', 'meetingLink', 'instructions']
    .filter((k) => k in changes && (changes[k] ?? null) !== (round[k] ?? null));
  const tellParticipants = visible.length > 0 && round.scheduledDate && req.body.notifyParticipants !== false;
  if (tellParticipants) {
    // rescheduleCount doubles as the calendar invite's SEQUENCE, so it moves
    // on any change the participants are told about; the candidate is asked
    // to confirm again.
    Object.assign(changes, { rescheduleCount: { increment: 1 }, candidateResponse: 'Pending', candidateResponseNote: null, candidateRespondedAt: null });
  }

  const result = await interviewModel.updateIfScheduled(round.id, changes);
  if (result.count === 0) return res.status(409).json({ error: 'This interview was changed by someone else - refresh and try again' });
  const updated = await interviewModel.findDetailed(round.id);

  if (tellParticipants) {
    await notifyCandidateSafely(updated.application.candidateId, 'InterviewRescheduled',
      invitations.candidateMessage('updated', updated, updated.application.vacancy.title),
      { calendar: invitations.candidateInvitation(updated, updated.application.vacancy.title) });
    if (['durationMinutes', 'mode', 'location', 'meetingLink'].some((k) => visible.includes(k))) {
      await syncPanelSafely([updated], 'updated');
    }
  }
  await audit(round.id, 'Interview details updated', req.user.id, { fields: Object.keys(changes).filter((k) => k !== 'rescheduleCount'), notified: !!tellParticipants });
  broadcast('updated', updated);
  res.json(decorate(updated));
}

async function reschedule(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'rescheduled')) return;
  if (!req.body.scheduledDate) return res.status(400).json({ error: 'Choose the new date and time' });

  const changes = parseLogistics(req.body, { partial: true });
  const reason = cleanText(req.body.reason, 1000);
  const merged = { ...round, ...changes };

  if (!req.body.allowConflicts) {
    const conflicts = await scheduling.findConflicts({
      slots: [{ key: round.applicationId, candidateId: round.application.candidateId, start: merged.scheduledDate, end: endOf(merged) }],
      panel: round.panelMembers, location: merged.location, mode: merged.mode, excludeRoundIds: [round.id]
    });
    if (conflicts.length) return conflictResponse(res, conflicts);
  }

  const result = await interviewModel.updateIfScheduled(round.id, {
    ...changes,
    rescheduleCount: { increment: 1 },
    // A confirmation of the old time says nothing about the new one, and
    // the reminder clocks restart from the new time.
    candidateResponse: 'Pending', candidateResponseNote: null, candidateRespondedAt: null,
    reminderSentAt: null, resultsReminderSentAt: null
  });
  if (result.count === 0) return res.status(409).json({ error: 'This interview was changed by someone else - refresh and try again' });
  const updated = await interviewModel.findDetailed(round.id);

  await audit(round.id, 'Interview rescheduled', req.user.id, {
    from: round.scheduledDate, to: updated.scheduledDate, reason,
    candidateHadAsked: round.candidateResponse === 'RescheduleRequested'
  });
  await notifyCandidateSafely(updated.application.candidateId, 'InterviewRescheduled',
    invitations.candidateMessage('rescheduled', updated, updated.application.vacancy.title, { reason }),
    { calendar: invitations.candidateInvitation(updated, updated.application.vacancy.title) });
  // Both days' meetings - the one it left and the one it moved to.
  const panelEmailed = req.body.notifyPanel === false ? 0 : await syncPanelSafely([round, updated], 'rescheduled', { reason });
  broadcast('rescheduled', updated);
  res.json({ ...decorate(updated), panelEmailed });
}

// ---------------------------------------------------------------------------
// Closing a round that didn't go ahead
// ---------------------------------------------------------------------------

// Called off before it happened. The candidate's and the panelists'
// calendar entries are cancelled or updated, and the application goes back
// to where it was before this round (interviewSchedulingService.statusAfterRoundClosed).
async function cancel(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'cancelled')) return;
  const reason = cleanText(req.body.reason, 1000);
  if (!reason) return res.status(400).json({ error: 'Give a reason for cancelling - it is kept in the audit trail' });

  const result = await interviewModel.updateIfScheduled(round.id, {
    status: 'Cancelled', cancelledAt: new Date(), cancelledById: req.user.id, cancellationReason: reason
  });
  if (result.count === 0) return res.status(409).json({ error: 'This interview was changed by someone else - refresh and try again' });

  await restoreApplicationStatus(round);
  await audit(round.id, 'Interview cancelled', req.user.id, { reason, scheduledDate: round.scheduledDate });

  if (req.body.notifyCandidate !== false) {
    await notifyCandidateSafely(round.application.candidateId, 'InterviewCancelled',
      invitations.candidateMessage('cancelled', round, round.application.vacancy.title, { reason }),
      { calendar: invitations.candidateInvitation(round, round.application.vacancy.title, { cancelled: true }) });
  }
  const updated = await interviewModel.findDetailed(round.id);
  const panelEmailed = req.body.notifyPanel === false ? 0 : await syncPanelSafely([updated], 'cancelled', { reason });
  broadcast('cancelled', updated);
  res.json({ ...decorate(updated), panelEmailed });
}

// The candidate didn't turn up. Only possible once the start time has
// passed. The candidate isn't notified - HR decides what happens next
// (another round, or an explicit reject).
async function markNoShow(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'marked as a no-show')) return;
  if (!round.scheduledDate || new Date(round.scheduledDate) > new Date()) {
    return res.status(422).json({ error: 'A no-show can only be recorded once the interview time has passed' });
  }
  const notes = cleanText(req.body.notes, 1000);

  const result = await interviewModel.updateIfScheduled(round.id, { status: 'NoShow' });
  if (result.count === 0) return res.status(409).json({ error: 'This interview was changed by someone else - refresh and try again' });

  await restoreApplicationStatus(round);
  await audit(round.id, 'Candidate did not attend interview', req.user.id, { notes, scheduledDate: round.scheduledDate });
  const updated = await interviewModel.findDetailed(round.id);
  broadcast('noShow', updated);
  res.json(decorate(updated));
}

// Only touches an application still sitting at InterviewScheduled - one that
// was rejected or offered in the meantime is left alone.
async function restoreApplicationStatus(round) {
  const status = await scheduling.statusAfterRoundClosed(round.applicationId, round.id);
  await applicationModel.updateIfStatus(round.applicationId, 'InterviewScheduled', { status });
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

// Add a panelist to a round after the fact - panel composition sometimes
// isn't finalized at scheduling time. They get the calendar invitation
// straight away when they have an email and the round has a time.
async function addPanelMember(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'changed')) return;

  const panelist = parsePanelist(req.body);
  if (round.panelMembers.length >= MAX_PANEL_SIZE) return res.status(422).json({ error: `A panel can have at most ${MAX_PANEL_SIZE} members` });
  if (round.panelMembers.some((m) => scheduling.samePerson(m, panelist))) {
    return res.status(409).json({ error: `${panelist.name} is already on this panel` });
  }

  if (!req.body.allowConflicts && round.scheduledDate) {
    const conflicts = await scheduling.findConflicts({
      slots: [{ key: round.applicationId, start: new Date(round.scheduledDate), end: endOf(round) }],
      panel: [panelist], excludeRoundIds: [round.id]
    });
    if (conflicts.length) return conflictResponse(res, conflicts);
  }

  if (panelist.isChair) await panelMemberModel.clearChair(round.id);
  const panelMember = await panelMemberModel.create({ interviewRoundId: round.id, ...panelist });
  await audit(round.id, 'Panelist added', req.user.id, { name: panelMember.name, email: panelMember.email });
  if (req.body.notify !== false && panelMember.email) {
    await syncPanelSafely([await interviewModel.findDetailed(round.id)], 'scheduled', { only: [panelMember.email] });
  }
  broadcast('panel', round);
  res.status(201).json(panelMember);
}

async function loadPanelMemberOr404(req, res) {
  const id = parseId(req.params.panelMemberId);
  if (!id) { res.status(400).json({ error: 'Invalid panel member id' }); return null; }
  const panelMember = await panelMemberModel.findWithRound(id);
  if (!panelMember) { res.status(404).json({ error: 'Panel member not found' }); return null; }
  return panelMember;
}

// Name/role/email or chair. A changed email moves the calendar invitation:
// the old address gets a cancellation, the new one the invitation.
async function updatePanelMember(req, res) {
  const panelMember = await loadPanelMemberOr404(req, res);
  if (!panelMember) return;
  if (!requireScheduled(panelMember.interviewRound, res, 'changed')) return;

  const data = {};
  if ('isChair' in req.body) data.isChair = !!req.body.isChair;
  const identityFields = ['name', 'trade', 'email'].filter((k) => k in req.body);
  if (identityFields.length) {
    const cleaned = parsePanelist({ ...panelMember, ...req.body });
    for (const k of identityFields) data[k] = cleaned[k];
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const before = await interviewModel.findDetailed(panelMember.interviewRoundId);
  if (data.isChair) await panelMemberModel.clearChair(panelMember.interviewRoundId);
  const updated = await panelMemberModel.update(panelMember.id, data);
  if ('email' in data && (data.email || '') !== (panelMember.email || '')) {
    const after = await interviewModel.findDetailed(panelMember.interviewRoundId);
    await syncPanelSafely([before, after], 'scheduled', { only: [panelMember.email, data.email] });
  }
  broadcast('panel', panelMember.interviewRound);
  res.json(updated);
}

// Take a panelist off the panel. Their calendar meeting for the day is
// updated, or cancelled if this was their only interview that day.
async function removePanelMember(req, res) {
  const panelMember = await loadPanelMemberOr404(req, res);
  if (!panelMember) return;
  if (!requireScheduled(panelMember.interviewRound, res, 'changed')) return;
  const before = await interviewModel.findDetailed(panelMember.interviewRoundId);
  await panelMemberModel.remove(panelMember.id);
  await audit(panelMember.interviewRoundId, 'Panelist removed', req.user.id, { name: panelMember.name, email: panelMember.email });
  if (panelMember.email && req.query.notify !== 'false') {
    await syncPanelSafely([before], 'removed', { only: [panelMember.email] });
  }
  broadcast('panel', panelMember.interviewRound);
  res.json({ message: `${panelMember.name} was removed from the panel` });
}

// ---------------------------------------------------------------------------
// Results - recorded from the panel's signed score sheet
// ---------------------------------------------------------------------------

// A file uploaded with a request that was then refused is not kept.
function discardUpload(file) {
  if (file?.path) fs.promises.rm(file.path, { force: true }).catch(() => {});
}

function parseScore(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new AppError("Enter the panel's overall score out of 100", 400);
  }
  const n = Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppError('The score must be a number from 0 to 100', 400);
  return Math.round(n * 10) / 10;
}

/**
 * PATCH /api/interviews/:id/results (multipart): the panel's overall score
 * (0-100), its verdict (Shortlist / Hold / Reject), optional notes and the
 * signed score sheet (scoreSheet - required the first time).
 *
 * First entry: only once the interview's time has passed. The round becomes
 * Completed; "Reject" rejects the application and tells the candidate, the
 * other verdicts move it to Interviewed, ready for the merit list.
 *
 * Correction (the round already has results): the score, notes and sheet,
 * and the verdict between Shortlist and Hold, until the candidate is placed
 * on the merit list. A rejection is final and can't be corrected here, nor
 * can a result be changed into one. Every entry and correction is audited
 * with the values before and after.
 */
async function recordResults(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) { discardUpload(req.file); return; }
  try {
    const correcting = round.status === 'Completed';
    if (!correcting && round.status !== 'Scheduled') {
      throw new AppError('This interview did not go ahead, so it has no results to record', 409);
    }
    if (!correcting && (!round.scheduledDate || new Date(round.scheduledDate) > new Date())) {
      throw new AppError('Results can be recorded once the interview has taken place', 422);
    }
    const score = parseScore(req.body.score);
    const { recommendation } = req.body;
    if (!RECOMMENDATIONS.includes(recommendation)) {
      throw new AppError(`Choose the panel's verdict: ${RECOMMENDATIONS.join(', ')}`, 400);
    }
    const notes = cleanText(req.body.notes, 2000);
    if (!correcting && !req.file) throw new AppError('Attach the signed score sheet', 400);

    const application = await applicationModel.findById(round.applicationId, { offer: true });
    if (correcting) {
      if (round.recommendation === 'Reject' || recommendation === 'Reject') {
        throw new AppError('A rejection is final and the candidate has been told - it can\'t be changed by correcting the results', 409);
      }
      if (application.meritStatus || application.offer) {
        throw new AppError('This candidate is already on the merit list - take them off it (re-propose without them) before correcting their results', 409);
      }
    } else if (!FINALIZABLE_STATUSES.includes(application.status)) {
      throw new AppError(`This application is at status "${application.status}" and can no longer have interview results recorded`, 409);
    }

    const now = new Date();
    const data = { score, recommendation, resultNotes: notes, conductedById: req.user.id, resultsRecordedAt: now };
    if (req.file) {
      data.scoreSheetUrl = fileUrl(req.file);
      data.scoreSheetName = String(req.file.originalname || 'score-sheet').slice(0, 190);
    }
    const result = correcting
      ? await interviewModel.updateIfCompleted(round.id, data)
      : await interviewModel.updateIfScheduled(round.id, { ...data, status: 'Completed', completedAt: now });
    if (result.count === 0) throw new AppError('This interview was changed by someone else - refresh and try again', 409);

    if (!correcting) {
      if (recommendation === 'Reject') {
        // Same path as applicationController's own reject() - rank/listStatus
        // cleared and rankVersion bumped for the same reasons.
        const updatedApplication = await applicationModel.update(round.applicationId, {
          status: 'Rejected', rejectedAt: now, rejectedById: req.user.id,
          rejectionReason: 'Not recommended following the interview panel\'s assessment.',
          rank: null, listStatus: null, ...CLEARED_MERIT, rankVersion: { increment: 1 }
        }, { vacancy: true });
        await notifyCandidateSafely(updatedApplication.candidateId, 'ApplicationRejected',
          `We're sorry to let you know your application for "${updatedApplication.vacancy.title}" was not successful this time.`);
      } else {
        await applicationModel.update(round.applicationId, { status: 'Interviewed' });
      }
    }

    const before = { score: round.score, recommendation: round.recommendation, resultNotes: round.resultNotes, scoreSheetName: round.scoreSheetName };
    const after = { score, recommendation, resultNotes: notes, scoreSheetName: data.scoreSheetName ?? round.scoreSheetName };
    await audit(round.id, correcting ? 'Interview results corrected' : 'Interview results recorded', req.user.id, { before, after });
    await auditService.record({
      entityType: 'Application', entityId: round.applicationId,
      action: correcting ? `Interview results corrected (round ${round.roundNumber})`
        : recommendation === 'Reject' ? 'Application rejected (interview panel)' : `Interview results recorded: ${recommendation}`,
      actor: auditService.actorFrom(req),
      before: correcting ? before : null, after, fields: ['score', 'recommendation', 'resultNotes', 'scoreSheetName'],
      details: { interviewRoundId: round.id }, comment: notes || null
    });
    broadcastDashboardEvent('InterviewRecommendation', { interviewId: round.id, applicationId: round.applicationId, recommendation });
    res.json(decorate(await interviewModel.findDetailed(round.id)));
  } catch (err) {
    discardUpload(req.file);
    throw err;
  }
}

module.exports = {
  SCHEDULABLE_STATUSES,
  schedule: wrap(schedule),
  planSession: wrap(planSession),
  scheduleSession: wrap(scheduleSession),
  schedulingContext: wrap(schedulingContext),
  list: wrap(list),
  attention: wrap(attention),
  getById: wrap(getById),
  scorecard: wrap(scorecard),
  calendarFile: wrap(calendarFile),
  update: wrap(update),
  reschedule: wrap(reschedule),
  cancel: wrap(cancel),
  markNoShow: wrap(markNoShow),
  addPanelMember: wrap(addPanelMember),
  updatePanelMember: wrap(updatePanelMember),
  removePanelMember: wrap(removePanelMember),
  recordResults: wrap(recordResults)
};
