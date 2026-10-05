const model = require('../models/shortlistCommitteeModel');
const committee = require('../services/shortlistCommitteeService');
const { computeRanking } = require('./shortlistCommitteeController');
const { sendUploadedFile } = require('./fileController');
const accessLog = require('../services/accessLogService');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// Public - a shortlisting committee member's private link (no account, no
// JWT; committee members are never HR staff). A member sees only the
// applicants assigned to them and only their own ratings - blind to the
// rest of the committee - and can change them until they submit. At
// moderation the chair's link also shows the disputed items, with every
// rater's view, to rule on - except for an applicant the chair stood down
// from, whose items go to the acting chair HR names for them. Documents open through this link only for the
// member's own applicants.

function parseJsonList(text) {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function loadMember(req, res) {
  const member = await model.findMemberByToken(req.params.token);
  if (!member) { res.status(410).json({ error: 'This link is no longer valid - ask HR for the current one' }); return null; }
  const { status } = member.exercise;
  if (status === 'Setup') { res.status(410).json({ error: 'Rating has not opened yet - HR will let you know' }); return null; }
  if (status === 'Closed') { res.status(410).json({ error: 'This shortlisting exercise has closed. Thank you.' }); return null; }
  if (member.exercise.accessExpiresAt && new Date(member.exercise.accessExpiresAt) <= new Date()) {
    res.status(410).json({ error: 'Access to this shortlisting exercise has ended. Please contact HR if you still need it.' }); return null;
  }
  return member;
}

function completeFor(criteria, assignment) {
  return Boolean(assignment.conflictAt) || criteria.every((c) => assignment.ratings.some((r) => r.criterionId === c.id));
}

// GET - the member's list and where they stand.
async function view(req, res) {
  const member = await loadMember(req, res);
  if (!member) return;
  const { exercise } = member;
  const assignments = await model.findMemberAssignments(member.id);
  const body = {
    name: member.name,
    isChair: member.isChair,
    stage: exercise.status,
    vacancy: exercise.vacancy,
    ratingDeadline: exercise.ratingDeadline,
    submittedAt: member.submittedAt,
    criteria: exercise.criteria,
    applicants: assignments.map((a) => ({
      applicationId: a.applicationId,
      candidateName: a.application.candidate.fullName,
      calibration: a.calibration,
      conflict: Boolean(a.conflictAt),
      rated: a.ratings.length,
      complete: completeFor(exercise.criteria, a)
    }))
  };
  if (exercise.status === 'Moderation') {
    const disputes = await disputesFor(exercise, member);
    if (member.isChair || disputes.length) body.disputes = disputes;
  }
  res.json(body);
}

// The moderation list for this member: every applicant with an essential
// criterion the committee couldn't settle (and the rulings so far). The
// chair sees them all; an acting chair sees the applicants they were named
// for. canRule says whether this member may rule on that applicant.
async function disputesFor(exercise, member) {
  const { rows } = await computeRanking(exercise);
  const essential = exercise.criteria.filter((c) => c.kind === 'Essential');
  return rows
    .filter((r) => r.band === 'Disputed' || r.criteria.some((c) => c.decidedByChair))
    .filter((r) => member.isChair || r.actingChair?.memberId === member.id)
    .map((r) => ({
      applicationId: r.applicationId,
      candidateName: r.candidateName,
      chairConflicted: r.chairConflicted,
      actingChair: r.actingChair ? r.actingChair.name : null,
      canRule: r.actingChair?.memberId === member.id || (member.isChair && !r.chairConflicted),
      items: essential
        .filter((c) => r.disputed.includes(c.id) || r.criteria.find((x) => x.id === c.id).decidedByChair)
        .map((c) => {
          const decision = (exercise.decisions || []).find((d) => d.applicationId === r.applicationId && d.criterionId === c.id);
          return {
            criterionId: c.id,
            label: c.label,
            decision: decision ? { outcome: decision.outcome, reason: decision.reason, by: decision.decidedByName } : null,
            ratings: r.raters.filter((x) => x.submitted && !x.conflict).map((x) => ({
              name: x.name, value: x.ratings[c.id]?.value ?? null, comment: x.ratings[c.id]?.comment || null
            }))
          };
        })
    }));
}

async function loadAssignment(req, res, member) {
  const applicationId = Number(req.params.applicationId);
  const assignment = Number.isInteger(applicationId) ? await model.findAssignment(member.id, applicationId) : null;
  if (!assignment) { res.status(404).json({ error: 'That applicant is not on your list' }); return null; }
  return assignment;
}

// GET one applicant - what they're being assessed on, with the automated
// checks and their own answers alongside each criterion as a reference.
async function applicant(req, res) {
  const member = await loadMember(req, res);
  if (!member) return;
  const assignment = await loadAssignment(req, res, member);
  if (!assignment) return;
  const app = await model.findApplicantForPanel(assignment.applicationId);
  const checks = Object.fromEntries(parseJsonList(app.essentialCriteriaResults).map((c) => [c.key, c]));
  const answers = Object.fromEntries((app.desirableResponses || []).map((r) => [r.id, r]));
  const fileUrl = (url) => (url ? `/api/shortlist-panel/${req.params.token}/files/${url.split('/').pop()}` : null);
  await accessLog.record(req, {
    action: 'Viewed an applicant (shortlisting committee)', vacancyId: app.vacancyId, applicationId: app.id,
    candidateIds: [app.candidateId], committeeMember: member
  });

  res.json({
    applicationId: app.id,
    candidate: app.candidate,
    whyThisRole: app.whyThisRole,
    eligibilityAnswers: app.disqualifyingResponses || [],
    documents: app.documents.map((d) => ({ ...d, fileUrl: fileUrl(d.fileUrl) })),
    coverLetterUrl: fileUrl(app.coverLetterUrl),
    criteria: member.exercise.criteria.map((c) => ({
      ...c,
      reference: c.autoKey && checks[c.autoKey]
        ? { source: 'System check', met: checks[c.autoKey].met, detail: checks[c.autoKey].detail }
        : c.question && answers[c.question]
          ? { source: 'Candidate\'s answer', detail: typeof answers[c.question].answer === 'boolean' ? (answers[c.question].answer ? 'Yes' : 'No') : String(answers[c.question].answer) }
          : null
    })),
    conflict: assignment.conflictAt ? { reason: assignment.conflictReason } : null,
    ratings: Object.fromEntries(assignment.ratings.map((r) => [r.criterionId, { value: r.value, comment: r.comment }])),
    editable: member.exercise.status === 'Rating' && !member.submittedAt && !assignment.conflictAt
  });
}

function assertRatingOpen(member, res) {
  if (member.exercise.status !== 'Rating') { res.status(422).json({ error: 'Rating has closed' }); return false; }
  if (member.submittedAt) { res.status(422).json({ error: 'You have submitted your ratings - they can no longer be changed' }); return false; }
  return true;
}

// PUT ratings - saves the member's ratings of one applicant. Partial saves
// are fine; a "Not met" on an essential criterion needs a comment saying why.
async function saveRatings(req, res) {
  const member = await loadMember(req, res);
  if (!member || !assertRatingOpen(member, res)) return;
  const assignment = await loadAssignment(req, res, member);
  if (!assignment) return;
  if (assignment.conflictAt) return res.status(422).json({ error: 'You declared a conflict of interest for this applicant' });
  const byId = new Map(member.exercise.criteria.map((c) => [c.id, c]));
  const input = Array.isArray(req.body.ratings) ? req.body.ratings : [];
  const rows = [];
  for (const r of input) {
    const criterion = byId.get(r?.criterionId);
    if (!criterion) return res.status(400).json({ error: 'Unknown criterion' });
    const value = Number(r.value);
    if (!committee.validRating(criterion, value)) {
      return res.status(400).json({ error: `"${criterion.label}": ${criterion.kind === 'Essential' ? 'choose Met, Partly met or Not met' : 'rate it 1 to 5'}` });
    }
    const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, 2000) || null : null;
    if (criterion.kind === 'Essential' && value === committee.NOT_MET && !comment) {
      return res.status(400).json({ error: `"${criterion.label}": say briefly why it is not met` });
    }
    rows.push({ criterionId: criterion.id, value, comment });
  }
  if (rows.length === 0) return res.status(400).json({ error: 'Nothing to save' });
  await model.saveRatings(assignment.id, rows);
  res.json({ saved: rows.length });
}

// POST conflict - the member stands down for this applicant; their ratings
// of them are cleared.
async function declareConflict(req, res) {
  const member = await loadMember(req, res);
  if (!member || !assertRatingOpen(member, res)) return;
  const assignment = await loadAssignment(req, res, member);
  if (!assignment) return;
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
  if (reason.length < 3) return res.status(400).json({ error: 'Please say briefly why' });
  await model.declareConflict(assignment.id, reason, new Date());
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: member.exercise.vacancyId });
  res.json({ message: 'Recorded. You won\'t rate this applicant.' });
}

// POST submit - final. Every assigned applicant must be fully rated (or
// stood down from).
async function submit(req, res) {
  const member = await loadMember(req, res);
  if (!member || !assertRatingOpen(member, res)) return;
  const assignments = await model.findMemberAssignments(member.id);
  const incomplete = assignments.filter((a) => !completeFor(member.exercise.criteria, a));
  if (incomplete.length) {
    return res.status(422).json({ error: `${incomplete.length} applicant(s) still need every criterion rated`, incomplete: incomplete.map((a) => a.applicationId) });
  }
  const result = await model.markSubmitted(member.id, new Date());
  if (result.count === 0) return res.status(409).json({ error: 'You have already submitted' });
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: member.exercise.vacancyId });
  res.json({ message: 'Your ratings have been submitted. Thank you.' });
}

// PUT decision - the chair's ruling on one disputed essential criterion.
async function decide(req, res) {
  const member = await loadMember(req, res);
  if (!member) return;
  if (member.exercise.status !== 'Moderation') return res.status(422).json({ error: 'Rulings are made at moderation' });
  const applicationId = Number(req.body.applicationId);
  const criterion = member.exercise.criteria.find((c) => c.id === req.body.criterionId);
  if (!criterion || criterion.kind !== 'Essential') return res.status(400).json({ error: 'Choose an essential criterion' });
  if (!['Met', 'NotMet'].includes(req.body.outcome)) return res.status(400).json({ error: 'Rule it Met or Not met' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
  if (reason.length < 3) return res.status(400).json({ error: 'Record the committee\'s reason' });

  const disputes = await disputesFor(member.exercise, member);
  const entry = disputes.find((d) => d.applicationId === applicationId);
  if (!entry) return res.status(403).json({ error: 'Only the chair, or the acting chair HR named for this applicant, can rule on it' });
  if (!entry.items.some((i) => i.criterionId === criterion.id)) {
    return res.status(422).json({ error: 'That item is not in dispute' });
  }
  if (!entry.canRule) {
    return res.status(403).json({ error: entry.actingChair
      ? `${entry.actingChair} is ruling on this applicant in your place`
      : 'You declared a conflict of interest for this applicant - HR will name an acting chair for it' });
  }
  await model.upsertDecision(member.exercise.id, applicationId, criterion.id, {
    outcome: req.body.outcome, reason, decidedByMemberId: member.id, decidedByName: member.name
  });
  broadcastDashboardEvent('ShortlistCommitteeUpdated', { vacancyId: member.exercise.vacancyId });
  res.json({ message: 'Ruling recorded.' });
}

// GET a document of one of the member's own applicants.
async function file(req, res) {
  const member = await loadMember(req, res);
  if (!member) return;
  const { filename } = req.params;
  const owned = await model.findAssignmentOwningFile(member.id, `/api/files/${filename}`);
  if (!owned) return res.status(403).json({ error: 'You do not have access to this file' });
  await accessLog.record(req, {
    action: 'Opened a document (shortlisting committee)', vacancyId: owned.application.vacancyId, applicationId: owned.applicationId,
    candidateIds: [owned.application.candidateId], detail: { document: filename }, committeeMember: member
  });
  sendUploadedFile(res, filename);
}

module.exports = { view, applicant, saveRatings, declareConflict, submit, decide, file };
