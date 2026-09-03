const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const positionModel = require('../models/positionModel');
const offerModel = require('../models/offerModel');
const workflow = require('../services/workflowService');
const slaModel = require('../models/slaModel');
const { generateJobRef } = require('../utils/jobRefGenerator');
const { sanitizeJobDescription } = require('../utils/htmlSanitizer');
const { validateVacancyEditableFields } = require('../utils/vacancyValidation');

// Title/Department come from the selected Position, not free text -
// resolved by the Position-table specification. positionsRequired,
// postingType, and deadline are validated the same way the original
// edge-case review required.
async function create(req, res) {
  const { positionId, reportsToPositionId, positionsRequired, postingType, deadline, salaryScale,
    description, regulatoryDriver, category, priority } = req.body;

  const position = await positionModel.findById(Number(positionId));
  if (!position) {
    return res.status(400).json({ error: 'Select a valid position' });
  }

  const fieldErrors = validateVacancyEditableFields({ positionsRequired, postingType, deadline });
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });

  // Reports-To must be a genuinely senior position in the exact same
  // department record - not merely a department with a matching name
  // (the "CWG appears under five directorates" case).
  let validatedReportsToId = null;
  if (reportsToPositionId) {
    const reportsTo = await positionModel.findById(Number(reportsToPositionId));
    if (!reportsTo || reportsTo.departmentId !== position.departmentId) {
      return res.status(400).json({ error: 'The selected "Reports To" position must be in the same department' });
    }
    if (reportsTo.level <= position.level) {
      return res.status(400).json({ error: 'The selected "Reports To" position must be senior to the vacancy’s own position' });
    }
    validatedReportsToId = reportsTo.id;
  }

  const jobRef = await generateJobRef(
    postingType || 'Open',
    new Date(),
    (prefix) => vacancyModel.countByJobRefPrefix(prefix)
  );

  const vacancy = await vacancyModel.create({
    jobRef,
    title: position.name, // immutable snapshot - protects history if Position is renamed later
    positionId: position.id,
    departmentId: position.departmentId, // derived, never independently supplied
    reportsToPositionId: validatedReportsToId,
    salaryScale: salaryScale || null,
    description: sanitizeJobDescription(description), // server-side sanitization - the layer that actually matters
    positionsRequired: positionsRequired !== undefined ? Number(positionsRequired) : 1,
    // FIXED - this was never set at all, so every vacancy defaulted to
    // the schema default (previously 'Open') and was immediately visible
    // to candidates, bypassing Principal HR Officer approval entirely.
    // The schema default is now also 'PendingApproval' as a second,
    // independent line of defense - this explicit value doesn't rely on
    // that default alone.
    status: 'PendingApproval',
    postingType: postingType || 'Open',
    deadline: deadline ? new Date(deadline) : null,
    regulatoryDriver, category, priority,
    createdById: req.user.id
  });
  res.status(201).json(vacancy);
}

// What CAN be edited after creation: positionsRequired (guarded against
// dropping below already-accepted offers), postingType, deadline,
// salaryScale, description, regulatoryDriver/category/priority.
// What CANNOT: positionId, departmentId, reportsToPositionId, jobRef -
// these are fixed at creation, consistent with `title` being an
// immutable snapshot rather than a live pointer.
async function update(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const { positionsRequired, postingType, deadline, salaryScale, description, regulatoryDriver, category, priority } = req.body;
  const fieldErrors = validateVacancyEditableFields({ positionsRequired, postingType, deadline }, { partial: true });
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });

  const data = {};
  if (postingType !== undefined) data.postingType = postingType;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (salaryScale !== undefined) data.salaryScale = salaryScale;
  if (description !== undefined) data.description = sanitizeJobDescription(description);
  if (regulatoryDriver !== undefined) data.regulatoryDriver = regulatoryDriver;
  if (category !== undefined) data.category = category;
  if (priority !== undefined) data.priority = priority;

  if (positionsRequired !== undefined) {
    const n = Number(positionsRequired);
    const acceptedCount = await offerModel.countAccepted(vacancyId);
    if (n < acceptedCount) {
      return res.status(422).json({
        error: `Cannot reduce positions required below ${acceptedCount}, the number of offers already accepted for this vacancy`
      });
    }
    data.positionsRequired = n;
  }

  const updated = await vacancyModel.update(vacancyId, data);
  res.json(updated);
}

async function close(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (vacancy.status === 'Closed') {
    return res.status(422).json({ error: 'This vacancy is already closed' });
  }

  const updated = await vacancyModel.update(vacancyId, { status: 'Closed' });
  res.json(updated);
}

// A Senior HR Officer+ check-by stage ahead of Principal HR Officer's
// final approval - a genuinely independent second set of eyes, not just
// a second click by the same PHRO. Allowed from the same states approve()
// itself accepts (PendingApproval, or Closed for the re-open-before-ever-
// reviewed case) so the two guards stay in lockstep; refuses re-reviewing
// something already reviewed rather than silently overwriting who/when.
async function review(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (['Open', 'PartiallyFilled', 'Filled'].includes(vacancy.status)) {
    return res.status(422).json({ error: 'This vacancy does not need review right now' });
  }
  if (vacancy.reviewedAt) {
    return res.status(422).json({ error: 'This vacancy has already been reviewed' });
  }

  try {
    // Same underlying rule as approve() (creator !== actor) - reused
    // rather than duplicated, but its error message is approval-specific,
    // so it's rewritten here to actually say "review".
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: 'Self-review blocked: route this review to DHRA / Manager HR instead' });
  }

  const updated = await vacancyModel.update(vacancyId, {
    reviewedAt: new Date(), reviewedById: req.user.id
  });
  res.json(updated);
}

async function approve(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // FIXED - previously no guard at all existed against approving a
  // vacancy already in an open-ish state, which made no sense once
  // PendingApproval exists as a real, distinct state to transition from.
  // Re-opening a previously Closed vacancy is still allowed - that is
  // the one legitimate reuse of this endpoint beyond first approval.
  if (['Open', 'PartiallyFilled', 'Filled'].includes(vacancy.status)) {
    return res.status(422).json({ error: 'This vacancy does not need approval right now' });
  }

  // NEW - the review/check-by gate: a Principal HR Officer cannot give
  // final approval until a Senior HR Officer+ has reviewed it first. A
  // vacancy that was reviewed, approved, then later closed still has
  // reviewedAt set from before, so re-opening it does not force a second
  // review - only a vacancy that has genuinely never been checked does.
  if (!vacancy.reviewedAt) {
    return res.status(422).json({ error: 'This vacancy must be reviewed by a Senior HR Officer before it can be approved' });
  }

  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const updated = await vacancyModel.update(vacancyId, {
    status: 'Open', approvedAt: new Date(), approvedById: req.user.id // now actually set - previously declared nowhere and never populated
  });

  // NEW - VacancyApproval can now be tracked and escalated by the SLA
  // checker, since approvedAt finally gives it a clean "resolved" signal.
  // Not possible before this fix (see the same resolveEscalations note
  // already left in applicationController.approveOffer and
  // departmentController.approve/reject).
  await slaModel.resolveEscalations('VacancyApproval', vacancyId);

  res.json(updated);
}

// candidateType comes from a verified JWT (req.user, set only by
// optionalAuthenticate if a valid token was presented), never from a
// client-supplied query string - closes the access-control gap found
// during the original edge-case review. Default is the safe (External)
// filter unless a genuinely verified Internal candidate says otherwise.
async function listPublic(req, res) {
  const candidateType = req.user?.type === 'candidate' ? req.user.candidateType : 'External';

  let where = { status: { in: ['Open', 'PartiallyFilled'] } };
  if (candidateType !== 'Internal') {
    where.postingType = { in: ['External', 'Open'] };
  }
  const vacancies = await vacancyModel.findManyWithDetails(where);
  res.json(vacancies);
}

// Not scoped by department. Every account that can reach this route (any
// staff role, gated at HR_Officer+ in routes/vacancies.js) is a member of
// the same DHRA HR team - they aren't department-specific business
// partners siloed to one department's hiring, they're the ones who
// create and manage vacancies across the whole organisation. An earlier
// version scoped this by req.user.departmentId, which was wrong for that
// reason (and, before that, by Department.name string-matching, which
// was wrong for a different reason - "CWG" recurs under five different
// directorates). Both are gone; every staff member sees every vacancy.
async function listForAdmin(req, res) {
  const vacancies = await vacancyModel.findManyForAdmin({});
  res.json(vacancies);
}

async function getOne(req, res) {
  const vacancy = await vacancyModel.findByIdWithDetails(Number(req.params.id));
  if (!vacancy) return res.status(404).json({ error: 'Not found' });
  res.json(vacancy);
}

async function listApplications(req, res) {
  const applications = await applicationModel.findByVacancy(Number(req.params.id));
  res.json(applications);
}

async function saveRanking(req, res) {
  const vacancyId = Number(req.params.id);
  const { applicationIds } = req.body;

  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const updates = [];
  for (let i = 0; i < applicationIds.length; i++) {
    const appId = applicationIds[i];
    try {
      await workflow.assertCanShortlist(appId);
    } catch (err) {
      return res.status(422).json({ error: `Application ${appId}: ${err.message}` });
    }
    const listStatus = i < vacancy.positionsRequired ? 'Primary' : 'Reserve';
    updates.push(applicationModel.update(appId, { rank: i + 1, listStatus, status: 'Shortlisted' }));
  }

  const results = await Promise.all(updates);
  res.json(results);
}

module.exports = { create, update, close, review, approve, listPublic, listForAdmin, getOne, listApplications, saveRanking };
