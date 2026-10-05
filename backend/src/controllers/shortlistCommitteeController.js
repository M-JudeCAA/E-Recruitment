const crypto = require('crypto');
const prisma = require('../config/db');
const model = require('../models/shortlistCommitteeModel');
const vacancyModel = require('../models/vacancyModel');
const committee = require('../services/shortlistCommitteeService');
const workflow = require('../services/workflowService');
const { computeExperienceYears } = require('../services/screeningService');
const { sendMail } = require('../utils/mailer');
const { frontendUrl } = require('../config/frontendUrl');
const { validateEmail } = require('../utils/validators');
const { internalDomains } = require('../services/entraAuthService');
const { escapeHtml, formatWhen } = require('../utils/interviewFormat');
const { classifyError, sendError } = require('../utils/errorResponse');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { ROLE_RANK } = require('../middleware/auth');
const delegationModel = require('../models/delegationModel');
const { notify, notifyAllWithRole } = require('../services/notificationService');
const conflictOfInterest = require('../services/conflictOfInterestService');

// HR's side of the shortlisting committee (shortlistCommitteeService.js has
// the ranking rules). HR builds the assessment sheet, invites the committee,
// opens rating, moves to moderation and closes the exercise - but never
// rates, and can't reorder the committee's result: the interview shortlist
// is proposed strictly from the top of it, then approved by a Principal HR
// Officer as before.

// Statuses that mean a shortlist has already been approved and acted on.
const PAST_SHORTLIST = ['Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered'];

function parseVacancyId(req, res) {
  const id = Number(req.params.vacancyId);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid vacancy id' }); return null; }
  return id;
}

function linkFor(member) {
  return `${frontendUrl}/shortlist-panel/${member.token}`;
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function audit(vacancyId, action, performedById, payload) {
  await prisma.auditLog.create({ data: { entityType: 'Vacancy', entityId: vacancyId, action, performedById, payload } });
}

// Sends a member their private link. Never throws - HR gets the link back
// to pass on by hand if the email fails.
async function emailMember(member, vacancy, exercise, kind, { candidateName } = {}) {
  const role = member.isChair ? 'as chair of the shortlisting committee' : 'as a member of the shortlisting committee';
  const lead = kind === 'moderation'
    ? '<p>Rating has closed. As chair, please use your link to settle the items the committee disagreed on.</p>'
    : kind === 'acting'
      ? `<p>The chair of the shortlisting committee for <strong>${escapeHtml(vacancy.jobRef)} ${escapeHtml(vacancy.title)}</strong> has a conflict
of interest for <strong>${escapeHtml(candidateName || 'one applicant')}</strong>. HR has asked you to rule, in the chair's place, on the items the
committee disagreed on for that applicant. You'll find them under "Disputed items" on your link.</p>`
      : `<p>You have been invited ${role} for <strong>${escapeHtml(vacancy.jobRef)} ${escapeHtml(vacancy.title)}</strong>.
Please rate each applicant assigned to you against the job's requirements.${exercise.ratingDeadline ? ` Ratings are due by ${escapeHtml(formatWhen(exercise.ratingDeadline))}.` : ''}
Your ratings stay private from the other members, and you can change them until you submit.</p>`;
  try {
    const info = await sendMail({
      to: member.email,
      subject: `Shortlisting committee - ${vacancy.jobRef} ${vacancy.title}`,
      html: `<p>Dear ${escapeHtml(member.name)},</p>${lead}
<p>Your private link (please don't share it): <a href="${linkFor(member)}">${linkFor(member)}</a></p>
<p>UCAA Human Resources</p>`
    });
    return info !== null;
  } catch (err) {
    console.error(`Could not email shortlisting committee member ${member.email}:`, err.message);
    return false;
  }
}

// The committee's current ranking, from every rating on record.
async function computeRanking(exercise) {
  const assignments = await model.findAssignmentsForExercise(exercise.id);
  const ids = [...new Set(assignments.map((a) => a.applicationId))];
  const apps = ids.length ? await model.findForResults(ids) : [];
  const rows = committee.computeResults(exercise.criteria, apps.map((a) => ({
    applicationId: a.id,
    experienceYears: computeExperienceYears(a.candidate.workExperience || []),
    ratings: assignments.filter((x) => x.applicationId === a.id).map((x) => ({
      memberSubmitted: Boolean(x.member.submittedAt),
      conflict: Boolean(x.conflictAt),
      values: Object.fromEntries(x.ratings.map((r) => [r.criterionId, r.value]))
    }))
  })), exercise.decisions || []);
  const appOf = new Map(apps.map((a) => [a.id, a]));
  const chair = (exercise.members || []).find((m) => m.isChair);
  return {
    assignments,
    rows: rows.map((r) => {
      const raters = assignments.filter((x) => x.applicationId === r.applicationId).map((x) => ({
        memberId: x.member.id, name: x.member.name, conflict: Boolean(x.conflictAt), conflictReason: x.conflictReason,
        submitted: Boolean(x.member.submittedAt),
        ratings: Object.fromEntries(x.ratings.map((rt) => [rt.criterionId, { value: rt.value, comment: rt.comment }]))
      }));
      return {
        ...r,
        candidateName: appOf.get(r.applicationId)?.candidate.fullName,
        status: appOf.get(r.applicationId)?.status,
        raters,
        // Who may rule on this applicant's disputed items: the chair, unless
        // they declared a conflict for them - then the acting chair HR named.
        chairConflicted: Boolean(chair && raters.some((x) => x.memberId === chair.id && x.conflict)),
        actingChair: actingChairOf(exercise, r.applicationId, raters)
      };
    })
  };
}

// The member HR named to rule for one applicant in a conflicted chair's
// place - ignored if that member has since stood down from the applicant.
function actingChairOf(exercise, applicationId, raters) {
  const entry = (Array.isArray(exercise.actingChairs) ? exercise.actingChairs : []).find((a) => a.applicationId === applicationId);
  if (!entry) return null;
  const member = (exercise.members || []).find((m) => m.id === entry.memberId);
  if (!member || raters.some((x) => x.memberId === member.id && x.conflict)) return null;
  return { memberId: member.id, name: member.name };
}

// During rating: applicants left with fewer than two raters who can still
// rate them (conflicts), and who HR could add - members not already on
// them and not yet submitted.
function coverageOf(exercise, rows) {
  return rows
    .filter((r) => r.raters.filter((x) => !x.conflict).length < committee.MIN_RATERS)
    .map((r) => ({
      applicationId: r.applicationId,
      candidateName: r.candidateName,
      raters: r.raters.map((x) => ({ name: x.name, conflict: x.conflict })),
      available: exercise.members
        .filter((m) => !m.submittedAt && !r.raters.some((x) => x.memberId === m.id))
        .map((m) => ({ id: m.id, name: m.name }))
    }));
}

function memberProgress(exercise, assignments) {
  const criterionIds = exercise.criteria.map((c) => c.id);
  return exercise.members.map((m) => {
    const mine = assignments.filter((a) => a.memberId === m.id);
    const done = mine.filter((a) => a.conflictAt || criterionIds.every((id) => a.ratings.some((r) => r.criterionId === id)));
    return {
      id: m.id, name: m.name, email: m.email, isChair: m.isChair, submittedAt: m.submittedAt, externalReason: m.externalReason,
      assigned: mine.length, completed: done.length, conflicts: mine.filter((a) => a.conflictAt).length
    };
  });
}

// --- The nomination (FR-ATS-046) ---
// HR nominates the members and submits them; the DHRA - a Director, by own
// role or an active delegation from one - approves, returns them with a
// reason, or edits the list first (every DHRA change is audited). Rating
// opens only once approved. An HR change to the members after approval puts
// the nomination back to Draft, to be submitted again.

async function isDhra(req) {
  if ((ROLE_RANK[req.user.role] || 0) >= ROLE_RANK.Director) return true;
  const delegation = await delegationModel.findActiveForDelegate(req.user.id, new Date());
  if (delegation && (ROLE_RANK[delegation.delegator.role] || 0) >= ROLE_RANK.Director) {
    await delegationModel.logUsage(delegation.id, `${req.method} ${req.originalUrl}`);
    req.actingAsDelegateFor = delegation.delegatorId;
    return true;
  }
  return false;
}

// Who is changing the members: 'dhra' while the nomination is with them,
// else 'hr'. Answers 409 (and returns null) for HR while it is submitted.
async function memberEditor(req, res, exercise) {
  if (exercise.status !== 'Setup') return 'hr';
  if (exercise.nominationStatus === 'Submitted') {
    if (await isDhra(req)) return 'dhra';
    res.status(409).json({ error: 'The nominations are with the DHRA for approval - only the DHRA can change the members now', code: 'NOMINATION_PENDING' });
    return null;
  }
  return 'hr';
}

async function afterMemberChange(req, exercise, editor, action, details) {
  if (exercise.status !== 'Setup') return;
  if (editor === 'dhra') {
    await audit(exercise.vacancyId, `DHRA ${action}`, req.user.id, { ...details, actingAsId: req.actingAsDelegateFor || null });
  } else if (exercise.nominationStatus === 'Approved') {
    await model.updateExercise(exercise.id, { nominationStatus: 'Draft', nominationDecidedAt: null, nominationDecidedById: null });
    await audit(exercise.vacancyId, 'Committee nomination reopened by a change to the members', req.user.id, { action, ...details });
  }
}

// GET - the exercise as HR sees it. Ratings stay out of view until rating
// closes; then the full ranking with each rater's view.
async function get(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });
  const [exercise, pool] = await Promise.all([model.findExerciseByVacancy(vacancyId), model.findPool(vacancyId)]);

  const base = {
    vacancy: { id: vacancy.id, jobRef: vacancy.jobRef, title: vacancy.title, positionsRequired: vacancy.positionsRequired, deadline: vacancy.deadline },
    poolCount: pool.length
  };
  if (!exercise) return res.json({ ...base, exercise: null, defaultCriteria: committee.defaultCriteria(vacancy) });

  const { assignments, rows } = exercise.status === 'Setup' ? { assignments: [], rows: [] } : await computeRanking(exercise);
  const showResults = ['Moderation', 'Closed'].includes(exercise.status);
  const { members, decisions, ...rest } = exercise;
  const peopleIds = [exercise.nominationSubmittedById, exercise.nominationDecidedById].filter(Boolean);
  const people = peopleIds.length ? await prisma.staffUser.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } }) : [];
  res.json({
    ...base,
    exercise: {
      ...rest,
      nominationSubmittedBy: people.find((p) => p.id === exercise.nominationSubmittedById) || null,
      nominationDecidedBy: people.find((p) => p.id === exercise.nominationDecidedById) || null,
      members: memberProgress(exercise, assignments),
      decisions,
      proposedCount: await model.countByStatus(vacancyId, ['ShortlistProposed']),
      approvedCount: await model.countByStatus(vacancyId, PAST_SHORTLIST),
      results: showResults ? rows : null,
      coverage: exercise.status === 'Rating' ? coverageOf(exercise, rows) : null,
      disputedCount: showResults ? rows.filter((r) => r.band === 'Disputed').length : null
    }
  });
}

// POST - sets up the exercise with the default sheet. Needs Begin Review
// done (the pool is the screened applications).
async function create(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });
  if (!vacancy.reviewStartedAt) return res.status(422).json({ error: 'Begin Review first - the committee assesses the screened applications' });
  if (await model.findExerciseByVacancy(vacancyId)) return res.status(409).json({ error: 'This vacancy already has a shortlisting committee' });
  if (await model.countByStatus(vacancyId, ['ShortlistProposed', ...PAST_SHORTLIST])) {
    return res.status(409).json({ error: 'A shortlist has already been proposed for this vacancy by hand' });
  }
  try {
    await model.createExercise({ vacancyId, criteria: committee.defaultCriteria(vacancy), createdById: req.user.id });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'This vacancy already has a shortlisting committee' });
    throw err;
  }
  await audit(vacancyId, 'Shortlisting committee set up', req.user.id, {});
  return get(req, res);
}

async function loadExercise(req, res, allowed) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return null;
  const exercise = await model.findExerciseByVacancy(vacancyId);
  if (!exercise) { res.status(404).json({ error: 'This vacancy has no shortlisting committee' }); return null; }
  if (allowed && !allowed.includes(exercise.status)) {
    res.status(422).json({ error: `Not possible while the exercise is at "${exercise.status}"` });
    return null;
  }
  return exercise;
}

// PATCH - the sheet and panel sizes (Setup), or the rating deadline (Setup/Rating).
async function update(req, res) {
  const exercise = await loadExercise(req, res, 'accessExpiresAt' in req.body ? ['Setup', 'Rating', 'Moderation'] : ['Setup', 'Rating']);
  if (!exercise) return;
  const data = {};
  try {
    if ('criteria' in req.body || 'ratersPerApplicant' in req.body || 'calibrationCount' in req.body) {
      if (exercise.status !== 'Setup') return res.status(422).json({ error: 'The assessment sheet is locked once rating opens' });
      if ('criteria' in req.body) data.criteria = committee.normalizeCriteria(req.body.criteria);
      if ('ratersPerApplicant' in req.body) {
        const n = Number(req.body.ratersPerApplicant);
        if (!Number.isInteger(n) || n < committee.MIN_MEMBERS || n > 15) return res.status(400).json({ error: `Raters per applicant must be ${committee.MIN_MEMBERS} to 15` });
        data.ratersPerApplicant = n;
      }
      if ('calibrationCount' in req.body) {
        const n = Number(req.body.calibrationCount);
        if (!Number.isInteger(n) || n < 0 || n > 50) return res.status(400).json({ error: 'The calibration set must be 0 to 50 applicants' });
        data.calibrationCount = n;
      }
    }
    if ('ratingDeadline' in req.body) {
      const d = req.body.ratingDeadline ? new Date(req.body.ratingDeadline) : null;
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid rating deadline' });
      data.ratingDeadline = d;
    }
    if ('accessExpiresAt' in req.body) {
      const d = req.body.accessExpiresAt ? new Date(req.body.accessExpiresAt) : null;
      if (d && Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid access end date' });
      if (d && d <= new Date()) return res.status(400).json({ error: 'The access end must be in the future' });
      data.accessExpiresAt = d;
    }
  } catch (err) {
    return sendError(res, err, 400);
  }
  await model.updateExercise(exercise.id, data);
  if ('accessExpiresAt' in data) {
    await audit(exercise.vacancyId, 'Shortlisting committee access end set', req.user.id, { accessExpiresAt: data.accessExpiresAt });
  }
  return get(req, res);
}

const MIN_EXTERNAL_REASON = 10;
const isInternalEmail = (email) => internalDomains().includes(email.split('@')[1]);

// Who may sit on the committee: anyone at UCAA, HR included; someone from
// outside only as a special case, with the reason. Never an applicant for
// the vacancy. Returns { error, status } or { externalReason }.
async function memberRules(exercise, email, externalReasonInput) {
  const applicant = await prisma.application.findFirst({
    where: { vacancyId: exercise.vacancyId, status: { not: 'Draft' }, candidate: { email } }, select: { id: true }
  });
  if (applicant) return { status: 422, error: 'This person has applied for this vacancy, so they cannot sit on its committee' };
  if (isInternalEmail(email)) return { externalReason: null };
  const reason = typeof externalReasonInput === 'string' ? externalReasonInput.trim().slice(0, 2000) : '';
  if (reason.length < MIN_EXTERNAL_REASON) {
    return {
      status: 422, code: 'EXTERNAL_REASON_REQUIRED',
      error: 'This is not a UCAA address. A member from outside UCAA is a special case - give the reason they are needed.'
    };
  }
  return { externalReason: reason };
}

// POST members - anyone at UCAA, HR included; an outsider with a reason.
async function addMember(req, res) {
  const exercise = await loadExercise(req, res, ['Setup']);
  if (!exercise) return;
  const editor = await memberEditor(req, res, exercise);
  if (!editor) return;
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (name.length < 2) return res.status(400).json({ error: 'Enter the member\'s name' });
  if (!validateEmail(email)) return res.status(400).json({ error: 'Enter a valid email - the member\'s private link is sent there' });
  if (exercise.members.some((m) => m.email.toLowerCase() === email)) return res.status(409).json({ error: 'This person is already on the committee' });
  const rules = await memberRules(exercise, email, req.body.externalReason);
  if (rules.error) return res.status(rules.status).json({ error: rules.error, ...(rules.code ? { code: rules.code } : {}) });

  if (req.body.isChair) await model.clearChair(exercise.id);
  await model.createMember({
    exerciseId: exercise.id, name, email, isChair: Boolean(req.body.isChair), token: newToken(), externalReason: rules.externalReason
  });
  if (rules.externalReason) {
    await audit(exercise.vacancyId, 'External shortlisting committee member added', req.user.id, { name, email, reason: rules.externalReason });
  }
  await afterMemberChange(req, exercise, editor, 'added a committee member', { name, email, isChair: Boolean(req.body.isChair) });
  return get(req, res);
}

async function loadMember(req, res, allowed) {
  const exercise = await loadExercise(req, res, allowed);
  if (!exercise) return {};
  const member = exercise.members.find((m) => m.id === Number(req.params.memberId));
  if (!member) { res.status(404).json({ error: 'Committee member not found' }); return {}; }
  return { exercise, member };
}

// PATCH member - make chair (any time before closing); name/email in Setup.
async function updateMember(req, res) {
  const { exercise, member } = await loadMember(req, res, ['Setup', 'Rating', 'Moderation']);
  if (!member) return;
  const editor = await memberEditor(req, res, exercise);
  if (!editor) return;
  const data = {};
  if ('name' in req.body || 'email' in req.body) {
    if (exercise.status !== 'Setup') return res.status(422).json({ error: 'Members can only be edited before rating opens' });
    if ('name' in req.body) {
      const name = String(req.body.name || '').trim();
      if (name.length < 2) return res.status(400).json({ error: 'Enter the member\'s name' });
      data.name = name;
    }
    if ('email' in req.body) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!validateEmail(email)) return res.status(400).json({ error: 'Enter a valid email' });
      if (exercise.members.some((m) => m.id !== member.id && m.email.toLowerCase() === email)) {
        return res.status(409).json({ error: 'This person is already on the committee' });
      }
      const rules = await memberRules(exercise, email, req.body.externalReason ?? member.externalReason);
      if (rules.error) return res.status(rules.status).json({ error: rules.error, ...(rules.code ? { code: rules.code } : {}) });
      data.email = email;
      data.externalReason = rules.externalReason;
    }
  }
  if (req.body.isChair === true) {
    await model.clearChair(exercise.id);
    data.isChair = true;
  }
  await model.updateMember(member.id, data);
  if (data.isChair) await audit(exercise.vacancyId, 'Shortlisting committee chair changed', req.user.id, { memberId: member.id, name: member.name });
  if (Object.keys(data).length) {
    await afterMemberChange(req, exercise, editor, data.email || data.name ? 'replaced or edited a committee member' : 'changed the chair',
      { memberId: member.id, before: { name: member.name, email: member.email }, after: { name: data.name ?? member.name, email: data.email ?? member.email } });
  }
  return get(req, res);
}

async function removeMember(req, res) {
  const { exercise, member } = await loadMember(req, res, ['Setup']);
  if (!member) return;
  const editor = await memberEditor(req, res, exercise);
  if (!editor) return;
  await model.deleteMember(member.id);
  await afterMemberChange(req, exercise, editor, 'removed a committee member', { memberId: member.id, name: member.name, email: member.email });
  return get(req, res);
}

// POST member link - a fresh link (the old one stops working), emailed and
// returned so HR can pass it on another way.
async function reissueLink(req, res) {
  const { exercise, member } = await loadMember(req, res, ['Rating', 'Moderation']);
  if (!member) return;
  const updated = await model.updateMember(member.id, { token: newToken() });
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  const emailed = await emailMember(updated, vacancy, exercise, exercise.status === 'Moderation' && updated.isChair ? 'moderation' : 'invite');
  res.status(201).json({ url: linkFor(updated), emailed });
}

// POST open - locks the sheet, assigns applicants and invites the committee.
async function openRating(req, res) {
  const exercise = await loadExercise(req, res, ['Setup']);
  if (!exercise) return;
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  if (vacancy.deadline && new Date(vacancy.deadline) > new Date()) {
    return res.status(422).json({ error: 'Rating can open once the application deadline has passed, so every applicant is assessed' });
  }
  if (exercise.members.length < committee.MIN_MEMBERS) {
    return res.status(422).json({ error: `Invite at least ${committee.MIN_MEMBERS} committee members` });
  }
  if (exercise.members.filter((m) => m.isChair).length !== 1) return res.status(422).json({ error: 'Choose a chair' });
  if (!exercise.criteria.some((c) => c.kind === 'Essential')) return res.status(422).json({ error: 'Add at least one Essential criterion' });
  if (exercise.nominationStatus !== 'Approved') {
    return res.status(422).json({ error: 'The DHRA must approve the committee before rating opens', code: 'NOMINATION_NOT_APPROVED' });
  }
  if (await model.countByStatus(vacancy.id, ['ShortlistProposed', ...PAST_SHORTLIST])) {
    return res.status(409).json({ error: 'A shortlist has already been proposed for this vacancy by hand' });
  }
  const pool = await model.findPool(vacancy.id);
  if (pool.length === 0) return res.status(422).json({ error: 'There are no screened applications to assess' });

  const moved = await model.moveExercise(exercise.id, 'Setup', { status: 'Rating', ratingOpenedAt: new Date(), ratingOpenedById: req.user.id });
  if (moved.count === 0) return res.status(409).json({ error: 'Rating has already been opened' });
  const plan = committee.planAssignments(pool.map((a) => a.id), exercise.members.map((m) => m.id), exercise);
  await model.createAssignments(plan);

  const links = [];
  for (const m of exercise.members) {
    const emailed = await emailMember(m, vacancy, exercise, 'invite');
    links.push({ memberId: m.id, name: m.name, emailed, url: emailed ? undefined : linkFor(m) });
  }
  await audit(vacancy.id, 'Shortlisting committee rating opened', req.user.id, { applicants: pool.length, members: exercise.members.length });
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: vacancy.id });
  res.json({ applicants: pool.length, assignments: plan.length, links });
}

// POST assignments - an extra rater for one applicant (e.g. after
// conflicts left too few - GET's `coverage` lists them). The member is
// told by email.
async function addAssignment(req, res) {
  const exercise = await loadExercise(req, res, ['Rating']);
  if (!exercise) return;
  const member = exercise.members.find((m) => m.id === Number(req.body.memberId));
  if (!member) return res.status(404).json({ error: 'Committee member not found' });
  if (member.submittedAt) return res.status(422).json({ error: `${member.name} has already submitted their ratings` });
  const applicationId = Number(req.body.applicationId);
  const assignments = await model.findAssignmentsForExercise(exercise.id);
  if (!assignments.some((a) => a.applicationId === applicationId)) return res.status(404).json({ error: 'That applicant is not in this exercise' });
  if (assignments.some((a) => a.applicationId === applicationId && a.memberId === member.id)) {
    return res.status(409).json({ error: `${member.name} already rates this applicant` });
  }
  await model.createAssignments([{ memberId: member.id, applicationId, calibration: false }]);
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  const candidateName = (await model.findForResults([applicationId]))[0]?.candidate.fullName;
  try {
    await sendMail({
      to: member.email,
      subject: `Shortlisting committee - one more applicant to rate (${vacancy.jobRef})`,
      html: `<p>Dear ${escapeHtml(member.name)},</p><p>HR has added <strong>${escapeHtml(candidateName || 'an applicant')}</strong> to your list for
${escapeHtml(vacancy.jobRef)} ${escapeHtml(vacancy.title)}, because other members stood down. Please rate them before you submit.</p>
<p>Your link: <a href="${linkFor(member)}">${linkFor(member)}</a></p><p>UCAA Human Resources</p>`
    });
  } catch (err) {
    console.error(`Could not email ${member.email} about an added applicant:`, err.message);
  }
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

// PUT acting-chairs { applicationId, memberId|null } - when the chair has a
// conflict of interest for an applicant, HR names another member to rule on
// that applicant's disputed items. Never the chair; never someone who stood
// down from that applicant.
async function setActingChair(req, res) {
  const exercise = await loadExercise(req, res, ['Rating', 'Moderation']);
  if (!exercise) return;
  const applicationId = Number(req.body.applicationId);
  const assignments = await model.findAssignmentsForExercise(exercise.id);
  const forApplicant = assignments.filter((a) => a.applicationId === applicationId);
  if (forApplicant.length === 0) return res.status(404).json({ error: 'That applicant is not in this exercise' });

  const others = (Array.isArray(exercise.actingChairs) ? exercise.actingChairs : []).filter((a) => a.applicationId !== applicationId);
  let member = null;
  if (req.body.memberId != null) {
    member = exercise.members.find((m) => m.id === Number(req.body.memberId));
    if (!member) return res.status(404).json({ error: 'Committee member not found' });
    if (member.isChair) return res.status(422).json({ error: 'The chair already rules unless they have a conflict - choose another member' });
    if (forApplicant.some((a) => a.memberId === member.id && a.conflictAt)) {
      return res.status(422).json({ error: `${member.name} stood down from this applicant` });
    }
    others.push({ applicationId, memberId: member.id });
  }
  await model.updateExercise(exercise.id, { actingChairs: others });
  await audit(exercise.vacancyId, 'Shortlisting committee acting chair named', req.user.id, { applicationId, memberId: member?.id || null });

  if (member && exercise.status === 'Moderation') {
    const vacancy = await vacancyModel.findById(exercise.vacancyId);
    const apps = await model.findForResults([applicationId]);
    await emailMember(member, vacancy, exercise, 'acting', { candidateName: apps[0]?.candidate.fullName });
  }
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

// POST moderation - closes rating. Members who haven't submitted don't count;
// HR has to confirm that (force).
async function startModeration(req, res) {
  const exercise = await loadExercise(req, res, ['Rating']);
  if (!exercise) return;
  const pending = exercise.members.filter((m) => !m.submittedAt);
  if (pending.length && req.body.force !== true) {
    return res.status(409).json({
      error: `${pending.map((m) => m.name).join(', ')} ha${pending.length === 1 ? 's' : 've'} not submitted - their ratings won't count if you close rating now`,
      code: 'MEMBERS_NOT_SUBMITTED', pending: pending.map((m) => m.name)
    });
  }
  const moved = await model.moveExercise(exercise.id, 'Rating', { status: 'Moderation', moderationStartedAt: new Date(), moderationStartedById: req.user.id });
  if (moved.count === 0) return res.status(409).json({ error: 'Rating has already closed' });

  const { rows } = await computeRanking(exercise);
  const disputed = rows.filter((r) => r.band === 'Disputed').length;
  const chair = exercise.members.find((m) => m.isChair);
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  if (chair && disputed > 0) await emailMember(chair, vacancy, exercise, 'moderation');
  // Acting chairs named during rating, for disputed applicants only.
  for (const r of rows.filter((x) => x.band === 'Disputed' && x.chairConflicted && x.actingChair)) {
    const acting = exercise.members.find((m) => m.id === r.actingChair.memberId);
    if (acting) await emailMember(acting, vacancy, exercise, 'acting', { candidateName: r.candidateName });
  }
  await audit(exercise.vacancyId, 'Shortlisting committee moderation started', req.user.id, { notSubmitted: pending.map((m) => m.name), disputed });
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

// POST close - snapshots the ranking onto the applications. Every dispute
// must be settled by the chair first.
async function close(req, res) {
  const exercise = await loadExercise(req, res, ['Moderation']);
  if (!exercise) return;
  const { rows } = await computeRanking(exercise);
  const disputed = rows.filter((r) => r.band === 'Disputed');
  if (disputed.length) {
    return res.status(422).json({ error: `The chair still has ${disputed.length} disputed applicant(s) to settle`, disputed: disputed.map((r) => r.candidateName) });
  }
  const moved = await model.moveExercise(exercise.id, 'Moderation', { status: 'Closed', closedAt: new Date(), closedById: req.user.id });
  if (moved.count === 0) return res.status(409).json({ error: 'The exercise has already been closed' });
  await prisma.$transaction(rows.map((r) => prisma.application.update({
    where: { id: r.applicationId },
    data: { committeeRank: r.rank, committeeBand: r.band, committeeScore: r.score, committeeAgreement: r.agreement }
  })));
  await audit(exercise.vacancyId, 'Shortlisting committee closed', req.user.id, {
    ranking: rows.map((r) => ({ applicationId: r.applicationId, rank: r.rank, band: r.band, score: r.score }))
  });
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

// POST propose { count } - the interview shortlist, strictly from the top of
// the committee's ranking (ties at the cut line all go through). Lands at
// ShortlistProposed for a Principal HR Officer to approve, exactly like a
// hand-made shortlist used to. Proposing again with a different count
// replaces the proposal, until one has been approved.
async function propose(req, res) {
  const exercise = await loadExercise(req, res, ['Closed']);
  if (!exercise) return;
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  if (await model.countByStatus(vacancy.id, PAST_SHORTLIST)) {
    return res.status(409).json({ error: 'A shortlist has already been approved for this vacancy' });
  }
  const ranked = await prisma.application.findMany({
    where: { vacancyId: vacancy.id, committeeRank: { not: null }, status: { in: ['UnderReview', 'ShortlistProposed'] } },
    select: { id: true, status: true, committeeRank: true, committeeBand: true }
  });
  let ids;
  try {
    ids = committee.shortlistFromResults(
      ranked.map((a) => ({ applicationId: a.id, band: a.committeeBand, rank: a.committeeRank })),
      Number(req.body.count), vacancy.positionsRequired
    );
  } catch (err) {
    return sendError(res, err, 400);
  }
  for (const id of ids) {
    try {
      await workflow.assertCanShortlist(id);
    } catch (err) {
      const { status, message } = classifyError(err, 422);
      if (status >= 500) return sendError(res, err, 422);
      return res.status(status).json({ error: `Application ${id}: ${message}` });
    }
  }
  const now = new Date();
  const dropped = ranked.filter((a) => a.status === 'ShortlistProposed' && !ids.includes(a.id));
  await prisma.$transaction([
    ...ids.map((id, i) => prisma.application.update({
      where: { id },
      data: {
        rank: i + 1, listStatus: null, status: 'ShortlistProposed', rankVersion: { increment: 1 },
        shortlistProposedAt: now, shortlistProposedById: req.user.id
      }
    })),
    ...dropped.map((a) => prisma.application.update({
      where: { id: a.id },
      data: { rank: null, status: 'UnderReview', rankVersion: { increment: 1 }, shortlistProposedAt: null, shortlistProposedById: null }
    }))
  ]);
  await audit(vacancy.id, 'Interview shortlist proposed from the committee ranking', req.user.id, { count: Number(req.body.count), applicationIds: ids });
  broadcastDashboardEvent('ApplicationUpdated', { vacancyId: vacancy.id });
  res.json({ proposed: ids.length, applicationIds: ids });
}

// POST nomination/submit - HR sends the members to the DHRA.
async function submitNomination(req, res) {
  const exercise = await loadExercise(req, res, ['Setup']);
  if (!exercise) return;
  if (!['Draft', 'Returned'].includes(exercise.nominationStatus)) {
    return res.status(409).json({ error: exercise.nominationStatus === 'Approved' ? 'The DHRA has already approved this committee' : 'The nominations are already with the DHRA' });
  }
  if (exercise.members.length < committee.MIN_MEMBERS) return res.status(422).json({ error: `Nominate at least ${committee.MIN_MEMBERS} members` });
  if (exercise.members.filter((m) => m.isChair).length !== 1) return res.status(422).json({ error: 'Choose a chair' });
  const moved = await prisma.shortlistExercise.updateMany({
    where: { id: exercise.id, nominationStatus: exercise.nominationStatus },
    data: { nominationStatus: 'Submitted', nominationSubmittedAt: new Date(), nominationSubmittedById: req.user.id, nominationReturnReason: null, nominationDecidedAt: null, nominationDecidedById: null }
  });
  if (moved.count === 0) return res.status(409).json({ error: 'The nomination changed meanwhile - reload and try again' });
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  await audit(exercise.vacancyId, 'Committee nomination submitted to the DHRA', req.user.id, { members: exercise.members.map((m) => ({ name: m.name, email: m.email, isChair: m.isChair })) });
  await notifyAllWithRole('Director', 'CommitteeNominationSubmitted', exercise.id,
    `The shortlisting committee for ${vacancy.jobRef} ${vacancy.title} (${exercise.members.length} members) is waiting for your approval.`).catch(() => {});
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

async function decideNomination(req, res, outcome) {
  const exercise = await loadExercise(req, res, ['Setup']);
  if (!exercise) return;
  if (exercise.nominationStatus !== 'Submitted') return res.status(409).json({ error: 'There is no nomination waiting for approval' });
  if (exercise.nominationSubmittedById === req.user.id) {
    return res.status(403).json({ error: 'You submitted this nomination - another Director must decide it', code: 'SELF_APPROVAL' });
  }
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
  if (outcome === 'Returned' && reason.length < 10) return res.status(400).json({ error: 'Say why the nomination is returned (10 characters or more)' });
  if (outcome === 'Approved') {
    if (exercise.members.length < committee.MIN_MEMBERS) return res.status(422).json({ error: `The committee needs at least ${committee.MIN_MEMBERS} members` });
    if (exercise.members.filter((m) => m.isChair).length !== 1) return res.status(422).json({ error: 'Choose a chair' });
  }
  const moved = await prisma.shortlistExercise.updateMany({
    where: { id: exercise.id, nominationStatus: 'Submitted' },
    data: { nominationStatus: outcome, nominationDecidedAt: new Date(), nominationDecidedById: req.user.id, nominationReturnReason: outcome === 'Returned' ? reason : null }
  });
  if (moved.count === 0) return res.status(409).json({ error: 'Someone else has already decided this nomination' });
  const vacancy = await vacancyModel.findById(exercise.vacancyId);
  await audit(exercise.vacancyId, outcome === 'Approved' ? 'Committee nomination approved by the DHRA' : 'Committee nomination returned by the DHRA', req.user.id, {
    reason: reason || undefined, actingAsId: req.actingAsDelegateFor || null,
    members: exercise.members.map((m) => ({ name: m.name, email: m.email, isChair: m.isChair }))
  });
  if (exercise.nominationSubmittedById) {
    await notify(exercise.nominationSubmittedById, 'CommitteeNominationDecided', exercise.id, outcome === 'Approved'
      ? `The DHRA approved the shortlisting committee for ${vacancy.jobRef} ${vacancy.title}. You can open rating once the application deadline has passed.`
      : `The DHRA returned the shortlisting committee for ${vacancy.jobRef} ${vacancy.title}: ${reason}`).catch(() => {});
  }
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: exercise.vacancyId });
  return get(req, res);
}

const approveNomination = (req, res) => decideNomination(req, res, 'Approved');
const returnNomination = (req, res) => decideNomination(req, res, 'Returned');

// GET nominations/pending - every committee waiting for the DHRA (the
// Approvals Center), leaving out vacancies the requester applied for.
async function pendingNominations(req, res) {
  const excluded = await conflictOfInterest.conflictedVacancyIds(req);
  const rows = await prisma.shortlistExercise.findMany({
    where: { nominationStatus: 'Submitted', ...(excluded.length ? { vacancyId: { notIn: excluded } } : {}) },
    include: {
      vacancy: { select: { id: true, jobRef: true, title: true, department: { select: { name: true } } } },
      members: { select: { id: true, name: true, email: true, isChair: true, externalReason: true }, orderBy: [{ isChair: 'desc' }, { id: 'asc' }] }
    },
    orderBy: { nominationSubmittedAt: 'asc' }
  });
  const submitters = await prisma.staffUser.findMany({ where: { id: { in: rows.map((r) => r.nominationSubmittedById).filter(Boolean) } }, select: { id: true, name: true } });
  res.json(rows.map((r) => ({
    exerciseId: r.id, vacancy: r.vacancy, members: r.members, submittedAt: r.nominationSubmittedAt,
    submittedBy: submitters.find((p) => p.id === r.nominationSubmittedById) || null
  })));
}

module.exports = {
  submitNomination, approveNomination, returnNomination, pendingNominations,
  get, create, update, addMember, updateMember, removeMember, reissueLink, openRating, addAssignment,
  startModeration, close, propose, setActingChair, computeRanking, PAST_SHORTLIST
};
