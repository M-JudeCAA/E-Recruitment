const crypto = require('crypto');
const prisma = require('../config/db');
const interviewModel = require('../models/interviewModel');
const applicationModel = require('../models/applicationModel');
const panelMemberModel = require('../models/panelMemberModel');
const panelAccessTokenModel = require('../models/panelAccessTokenModel');
const vacancyModel = require('../models/vacancyModel');
const interviewService = require('../services/interviewService');
const scheduling = require('../services/interviewSchedulingService');
const invitations = require('../services/interviewInvitationService');
const panelAccessService = require('../services/panelAccessService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { AppError, sendError } = require('../utils/errorResponse');
const { validateEmail } = require('../utils/validators');
const { buildCalendar } = require('../utils/icsCalendar');
const { endOf } = require('../utils/interviewFormat');

// Applications an interview can legitimately be scheduled against - mirrors
// the frontend's own gate (status in this list AND no offer yet) so a stale
// UI or a direct API call can't schedule a round on a Rejected/Offered/
// Withdrawn application.
const SCHEDULABLE_STATUSES = ['Shortlisted', 'InterviewScheduled', 'Interviewed'];

// Statuses an application may still validly be in when a round against it
// is finalized. Guards finalizeRecommendation below against a stale round
// (scheduled a while ago, never finalized) being resolved after the
// application already moved on elsewhere - an explicit HR reject, or an
// offer recommended off a different, later round.
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

// The shape every Hub endpoint returns for a round: the parsed rubric, where
// the panel stands, and (when known) which panelists hold a working link.
function decorate(round, activeLinks) {
  const progress = interviewService.panelProgress(round.panelMembers || []);
  return {
    ...round,
    criteria: interviewService.criteriaOf(round),
    progress,
    highSpread: progress.spread != null && progress.spread >= interviewService.HIGH_SPREAD,
    criterionAverages: interviewService.criterionAverages(round, round.panelMembers || []),
    panelMembers: (round.panelMembers || []).map((m) => ({
      ...m,
      ...(activeLinks ? { activeLinkExpiresAt: activeLinks.get(m.id) || null } : {})
    }))
  };
}

async function audit(entityId, action, performedById, payload) {
  await prisma.auditLog.create({ data: { entityType: 'InterviewRound', entityId, action, performedById, payload } });
}

// Notifications are a side effect of an action that already committed - a
// failure here must never turn the response into a 500.
async function notifyCandidateSafely(candidateId, type, message) {
  try {
    await notifyCandidate(candidateId, type, message);
  } catch (err) {
    console.error(`Failed to send ${type} candidate notification:`, err);
  }
}

async function emailPanelSafely(rounds, kind, options) {
  try {
    return await invitations.emailPanel(rounds, kind, options);
  } catch (err) {
    console.error(`Failed to email interview panel (${kind}):`, err);
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

// One interview for one application (the review card's "Schedule interview").
// Round number is computed server-side from existing rounds for this
// application, not taken from the client.
async function schedule(req, res) {
  const applicationId = parseId(req.params.applicationId);
  if (!applicationId) return res.status(400).json({ error: 'Invalid application id' });

  const application = await applicationModel.findById(applicationId, { offer: true, vacancy: true });
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (!SCHEDULABLE_STATUSES.includes(application.status) || application.offer) {
    return res.status(422).json({ error: `An application at status "${application.status}" cannot have an interview scheduled` });
  }

  const logistics = parseLogistics(req.body);
  const panel = parsePanel(req.body.panelMembers);
  const criteria = interviewService.normalizeCriteria(req.body.criteria);

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
      round: { applicationId, ...logistics, criteria, scheduledById: req.user.id },
      panel
    }], SCHEDULABLE_STATUSES);
  } catch (err) {
    if (err.code === 'NOT_SCHEDULABLE') return notSchedulableResponse(res, err);
    throw err;
  }

  const [round] = await interviewModel.findManyDetailed([created.id]);
  // The candidate's only channel for learning an interview exists (and
  // where/when it is) - scheduledDate can still be null ("to be confirmed").
  await notifyCandidateSafely(application.candidateId, 'InterviewScheduled',
    invitations.candidateMessage('scheduled', round, application.vacancy.title));
  const panelEmailed = req.body.notifyPanel === false ? 0 : await emailPanelSafely([round], 'scheduled');

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
  const blocked = apps.filter((a) => !SCHEDULABLE_STATUSES.includes(a.status) || a.offer);
  if (blocked.length) {
    throw new AppError(`Not schedulable: ${blocked.map((a) => `${a.candidate.fullName} (${a.status})`).join(', ')}`, 422);
  }

  const logistics = parseLogistics({ ...req.body, scheduledDate: undefined });
  delete logistics.scheduledDate;
  const panel = parsePanel(req.body.panelMembers);
  const criteria = interviewService.normalizeCriteria(req.body.criteria);
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
  return { vacancyId, ordered, conflicts, logistics, panel, criteria };
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
// slots for every chosen candidate, one shared panel and rubric, one
// transaction. Candidates are each notified of their own slot; each
// panelist gets ONE email with a calendar invite covering all their slots.
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
        criteria: session.criteria,
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
      invitations.candidateMessage('scheduled', round, round.application.vacancy.title));
  }
  const panelEmailed = req.body.notifyPanel === false ? 0 : await emailPanelSafely(rounds, 'scheduled');

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
// panelists and rubric used on it before (one click to reuse), and the
// logistics of the last round as sensible defaults.
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
  const withRubric = rounds.find((r) => interviewService.criteriaOf(r));

  res.json({
    vacancy: { id: vacancy.id, jobRef: vacancy.jobRef, title: vacancy.title, positionsRequired: vacancy.positionsRequired },
    applications,
    previousPanelists,
    lastCriteria: withRubric ? interviewService.criteriaOf(withRubric).map(({ name, weight, description }) => ({ name, weight, description })) : null,
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
  const rounds = await interviewModel.list({
    from: parseDateParam(req.query.from),
    to: parseDateParam(req.query.to),
    vacancyId: parseId(req.query.vacancyId) || undefined,
    status: status && status.length ? status : undefined,
    search: cleanText(req.query.search, 100) || undefined,
    sessionKey: cleanText(req.query.sessionKey, 40) || undefined
  });
  res.json(rounds.map((r) => decorate(r)));
}

// Everything in the interview pipeline that is waiting on somebody, bucketed
// so the Hub can show HR what to do next rather than just what exists.
async function attention(req, res) {
  const now = new Date();
  const [open, shortlisted] = await Promise.all([
    interviewModel.openRounds(),
    applicationModel.findShortlistedUnscheduled()
  ]);
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
    readyToFinalize: rounds.filter((r) => r.progress.complete && !r.recommendation),
    awaitingScores: rounds.filter((r) => past(r) && !r.progress.complete),
    unconfirmed: rounds.filter((r) => r.scheduledDate && !past(r) && r.candidateResponse === 'Pending'
      && new Date(r.scheduledDate) - now <= UNCONFIRMED_WINDOW_MS),
    noDate: rounds.filter((r) => !r.scheduledDate),
    noPanel: rounds.filter((r) => r.progress.total === 0),
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
  const [links, siblings] = await Promise.all([
    panelAccessTokenModel.findActiveForRound(round.id),
    interviewModel.findByApplication(round.applicationId)
  ]);
  const activeLinks = new Map(links.map((l) => [l.panelMemberId, l.expiresAt]));
  res.json({
    ...decorate(round, activeLinks),
    otherRounds: siblings
      .filter((r) => r.id !== round.id)
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map(({ id, roundNumber, status, scheduledDate, score, recommendation }) => ({ id, roundNumber, status, scheduledDate, score, recommendation }))
  });
}

// Side-by-side comparison of every candidate interviewed for a vacancy -
// latest held round per candidate, with the per-criterion breakdown and a
// flag where the panel disagreed. Sorted best score first.
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
      offerStatus: app.offer?.status || null,
      rounds: appRounds.length,
      noShows: appRounds.filter((r) => r.status === 'NoShow').length,
      latestRound: {
        id: d.id, roundNumber: d.roundNumber, status: d.status, scheduledDate: d.scheduledDate,
        score: d.score, recommendation: d.recommendation, progress: d.progress, highSpread: d.highSpread,
        criterionAverages: d.criterionAverages
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

// Edits details other than the time (use reschedule for that). The rubric
// can only change until the first panelist scores against it. A change the
// candidate/panel would care about (venue, link, length, mode) tells them,
// unless notifyParticipants is false.
async function update(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'edited')) return;

  const changes = parseLogistics(req.body, { partial: true });
  delete changes.scheduledDate;
  if (Object.prototype.hasOwnProperty.call(req.body, 'criteria')) {
    if (round.panelMembers.some((m) => m.score != null)) {
      return res.status(409).json({ error: 'The rubric is locked - a panelist has already scored against it' });
    }
    changes.criteria = interviewService.normalizeCriteria(req.body.criteria);
  }
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
      invitations.candidateMessage('updated', updated, updated.application.vacancy.title));
    if (['durationMinutes', 'mode', 'location', 'meetingLink'].some((k) => visible.includes(k))) {
      await emailPanelSafely([updated], 'rescheduled');
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
    const panel = round.panelMembers.filter((m) => !m.recusedAt);
    const conflicts = await scheduling.findConflicts({
      slots: [{ key: round.applicationId, candidateId: round.application.candidateId, start: merged.scheduledDate, end: endOf(merged) }],
      panel, location: merged.location, mode: merged.mode, excludeRoundIds: [round.id]
    });
    if (conflicts.length) return conflictResponse(res, conflicts);
  }

  const result = await interviewModel.updateIfScheduled(round.id, {
    ...changes,
    rescheduleCount: { increment: 1 },
    // A confirmation of the old time says nothing about the new one, and
    // the reminder/score-nudge clocks restart from the new time.
    candidateResponse: 'Pending', candidateResponseNote: null, candidateRespondedAt: null,
    reminderSentAt: null, scoreNudgeSentAt: null
  });
  if (result.count === 0) return res.status(409).json({ error: 'This interview was changed by someone else - refresh and try again' });
  const updated = await interviewModel.findDetailed(round.id);

  await audit(round.id, 'Interview rescheduled', req.user.id, {
    from: round.scheduledDate, to: updated.scheduledDate, reason,
    candidateHadAsked: round.candidateResponse === 'RescheduleRequested'
  });
  await notifyCandidateSafely(updated.application.candidateId, 'InterviewRescheduled',
    invitations.candidateMessage('rescheduled', updated, updated.application.vacancy.title, { reason }));
  const panelEmailed = req.body.notifyPanel === false ? 0 : await emailPanelSafely([updated], 'rescheduled', { reason });
  broadcast('rescheduled', updated);
  res.json({ ...decorate(updated), panelEmailed });
}

// Called off before it happened. Every outstanding scoring link stops
// working, and the application goes back to where it was before this round
// (see interviewSchedulingService.statusAfterRoundClosed).
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

  await panelAccessTokenModel.markAllUsedForRound(round.id);
  await restoreApplicationStatus(round);
  await audit(round.id, 'Interview cancelled', req.user.id, { reason, scheduledDate: round.scheduledDate });

  if (req.body.notifyCandidate !== false) {
    await notifyCandidateSafely(round.application.candidateId, 'InterviewCancelled',
      invitations.candidateMessage('cancelled', round, round.application.vacancy.title, { reason }));
  }
  const panelEmailed = req.body.notifyPanel === false ? 0 : await emailPanelSafely([round], 'cancelled', { reason });
  const updated = await interviewModel.findDetailed(round.id);
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

  await panelAccessTokenModel.markAllUsedForRound(round.id);
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
// isn't finalized at scheduling time. They get the calendar invite straight
// away when they have an email and the round has a time.
async function addPanelMember(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'changed')) return;

  const panelist = parsePanelist(req.body);
  const active = round.panelMembers.filter((m) => !m.recusedAt);
  if (active.length >= MAX_PANEL_SIZE) return res.status(422).json({ error: `A panel can have at most ${MAX_PANEL_SIZE} members` });
  if (active.some((m) => scheduling.samePerson(m, panelist))) {
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
  if (req.body.notify !== false) await emailPanelSafely([{ ...round, panelMembers: [panelMember] }], 'scheduled');
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

async function updatePanelMember(req, res) {
  const panelMember = await loadPanelMemberOr404(req, res);
  if (!panelMember) return;
  if (!requireScheduled(panelMember.interviewRound, res, 'changed')) return;

  const data = {};
  if ('isChair' in req.body) data.isChair = !!req.body.isChair;
  const identityFields = ['name', 'trade', 'email'].filter((k) => k in req.body);
  if (identityFields.length) {
    if (panelMember.score != null) {
      return res.status(409).json({ error: 'This panelist has already scored - their details can no longer change' });
    }
    const cleaned = parsePanelist({ ...panelMember, ...req.body });
    for (const k of identityFields) data[k] = cleaned[k];
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  if (data.isChair) await panelMemberModel.clearChair(panelMember.interviewRoundId);
  // A changed email means any link already sent went to the wrong place.
  if ('email' in data && data.email !== panelMember.email) await panelAccessService.revokeOutstandingTokens(panelMember.id);
  const updated = await panelMemberModel.update(panelMember.id, data);
  broadcast('panel', panelMember.interviewRound);
  res.json(updated);
}

// Removing is for a panelist added by mistake - only before they've scored.
// Someone who was genuinely on the panel but stands down is recused instead,
// so the record of who was on the panel stays intact.
async function removePanelMember(req, res) {
  const panelMember = await loadPanelMemberOr404(req, res);
  if (!panelMember) return;
  if (!requireScheduled(panelMember.interviewRound, res, 'changed')) return;
  if (panelMember.score != null) {
    return res.status(409).json({ error: 'This panelist has already scored - recuse them instead of removing them' });
  }
  await panelMemberModel.remove(panelMember.id);
  await audit(panelMember.interviewRoundId, 'Panelist removed', req.user.id, { name: panelMember.name, email: panelMember.email });
  broadcast('panel', panelMember.interviewRound);
  res.json({ message: `${panelMember.name} was removed from the panel` });
}

// A panelist stands down for this candidate - typically a declared conflict
// of interest. Their score (if any) stops counting and their link stops
// working; the record of them having been on the panel stays.
async function recusePanelMember(req, res) {
  const panelMember = await loadPanelMemberOr404(req, res);
  if (!panelMember) return;
  if (!requireScheduled(panelMember.interviewRound, res, 'changed')) return;
  if (panelMember.recusedAt) return res.status(409).json({ error: `${panelMember.name} has already stood down` });
  const reason = cleanText(req.body.reason, 1000);
  if (!reason) return res.status(400).json({ error: 'Give a reason for the recusal - it is kept in the audit trail' });

  await panelMemberModel.update(panelMember.id, { recusedAt: new Date(), recusalReason: reason, isChair: false });
  await panelAccessService.revokeOutstandingTokens(panelMember.id);
  await interviewService.recomputeRoundScore(panelMember.interviewRoundId);
  await audit(panelMember.interviewRoundId, 'Panelist recused', req.user.id, { name: panelMember.name, reason, hadScored: panelMember.score != null });
  broadcast('panel', panelMember.interviewRound);
  res.json({ message: `${panelMember.name} has stood down from this interview` });
}

// Proxy score entry: the coordinating HR Officer records a panelist's
// score/comments on their behalf. The panelist never needs a system
// account for this - recordedById captures who actually entered it.
// Re-scoring an already-scored panelist is deliberately still allowed (a
// legitimate correction path). With a rubric, the per-criterion ratings are
// sent and the 0-100 score is computed from them.
async function recordPanelScore(req, res) {
  const panelMemberId = parseId(req.params.panelMemberId);
  if (!panelMemberId) return res.status(400).json({ error: 'Invalid panel member id' });

  const existing = await panelMemberModel.findWithRound(panelMemberId);
  if (!existing) return res.status(404).json({ error: 'Panel member not found' });
  const round = existing.interviewRound;
  if (['Cancelled', 'NoShow'].includes(round.status)) {
    return res.status(409).json({ error: 'This interview did not go ahead, so it cannot be scored' });
  }
  if (existing.recusedAt) return res.status(409).json({ error: `${existing.name} has stood down from this interview` });

  const { score, criterionScores } = interviewService.resolveSubmittedScore(round, req.body);
  const panelMember = await interviewService.recordPanelScore(
    panelMemberId, { score, criterionScores, comments: cleanText(req.body.comments, 4000) }, req.user.id
  );
  // HR entered it, so any link the panelist still holds is now pointless.
  await panelAccessService.revokeOutstandingTokens(panelMemberId);
  broadcast('score', round);
  res.json(panelMember);
}

// Sends (or re-sends) a scoring link to every panelist on the round who
// hasn't scored yet - one click after the interview instead of one per
// panelist. Links for panelists without an email come back to HR to share.
async function sendAllLinks(req, res) {
  const round = await loadRoundOr404(req, res);
  if (!round) return;
  if (!requireScheduled(round, res, 'scored')) return;

  const pending = round.panelMembers.filter((m) => m.score == null && !m.recusedAt);
  if (pending.length === 0) return res.status(422).json({ error: 'Every panelist has already scored' });

  const results = [];
  for (const m of pending) {
    const { url, emailed } = await panelAccessService.issueLink(m, round);
    results.push({ panelMemberId: m.id, name: m.name, emailed, url: emailed ? undefined : url });
  }
  broadcast('links', round);
  res.status(201).json({ results });
}

// A deliberate HR judgment call, not an average - requires at least one
// panel score already on record so the recommendation is actually informed
// by panel input rather than being a bare guess.
async function finalizeRecommendation(req, res) {
  const interviewId = parseId(req.params.interviewId);
  if (!interviewId) return res.status(400).json({ error: 'Invalid interview round id' });
  const { recommendation } = req.body;
  if (!RECOMMENDATIONS.includes(recommendation)) {
    return res.status(400).json({ error: `recommendation must be one of ${RECOMMENDATIONS.join(', ')}` });
  }
  const notes = cleanText(req.body.notes, 2000);

  const panelMembers = await panelMemberModel.findByRound(interviewId);
  const hasAnyScore = panelMembers.some((m) => m.score != null && !m.recusedAt);
  if (!hasAnyScore) {
    return res.status(422).json({ error: 'At least one panel member score is required before finalizing a recommendation' });
  }

  const existingRound = await interviewModel.findById(interviewId);
  if (!existingRound) return res.status(404).json({ error: 'Interview round not found' });
  if (existingRound.status && !['Scheduled', 'Completed'].includes(existingRound.status)) {
    return res.status(409).json({ error: 'This interview did not go ahead, so it cannot be finalized' });
  }

  // Guards against finalizing a stale round after its application already
  // moved on elsewhere since it was scheduled - an explicit HR reject, or
  // an offer recommended off a different, later round. The writes below
  // are otherwise unconditional and would silently regress a terminal/
  // later status back to Interviewed or Rejected.
  const application = await applicationModel.findById(existingRound.applicationId);
  if (!FINALIZABLE_STATUSES.includes(application.status)) {
    return res.status(409).json({
      error: `This application is at status "${application.status}" and can no longer have an interview finalized against it`
    });
  }

  // Atomic guard - scoped to recommendation: null, so a second finalize call
  // on the same round (double-click, or two HR officers racing) can't
  // silently overwrite an already-finalized recommendation.
  const guardResult = await interviewModel.updateIfNoRecommendation(interviewId, {
    recommendation, conductedById: req.user.id, status: 'Completed', completedAt: new Date()
  });
  if (guardResult.count === 0) {
    return res.status(409).json({ error: 'This interview round already has a finalized recommendation' });
  }
  const round = await interviewModel.findById(interviewId);
  // Nobody should be scoring a round whose verdict is in.
  await panelAccessTokenModel.markAllUsedForRound(interviewId);
  if (notes) await audit(interviewId, 'Interview recommendation finalized', req.user.id, { recommendation, notes });

  // "Reject" routes through the same status/notification path as
  // applicationController's own reject() - rank/listStatus cleared and
  // rankVersion bumped for the same reasons.
  if (recommendation === 'Reject') {
    const updatedApplication = await applicationModel.update(round.applicationId, {
      status: 'Rejected', rejectedAt: new Date(), rejectedById: req.user.id,
      rejectionReason: 'Not recommended for offer following the interview panel\'s review.',
      rank: null, listStatus: null, rankVersion: { increment: 1 }
    }, { vacancy: true });
    await notifyCandidate(
      updatedApplication.candidateId, 'ApplicationRejected',
      `We're sorry to let you know your application for "${updatedApplication.vacancy.title}" was not successful this time.`
    );
  } else {
    // Only now, once a recommendation has actually been finalized, does
    // the application move to "Interviewed".
    await applicationModel.update(round.applicationId, { status: 'Interviewed' });
  }
  broadcastDashboardEvent('InterviewRecommendation', { interviewId, applicationId: round.applicationId, recommendation });
  res.json(round);
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
  recusePanelMember: wrap(recusePanelMember),
  recordPanelScore: wrap(recordPanelScore),
  sendAllLinks: wrap(sendAllLinks),
  finalizeRecommendation: wrap(finalizeRecommendation)
};
