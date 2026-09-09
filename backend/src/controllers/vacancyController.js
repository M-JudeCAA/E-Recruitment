const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const positionModel = require('../models/positionModel');
const offerModel = require('../models/offerModel');
const workflow = require('../services/workflowService');
const slaModel = require('../models/slaModel');
const { generateJobRef } = require('../utils/jobRefGenerator');
const { sanitizeJobDescription } = require('../utils/htmlSanitizer');
const {
  validateVacancyEditableFields,
  normalizeStringList, normalizeDesirableRequirements
} = require('../utils/vacancyValidation');

// Title/Department come from the selected Position, not free text -
// resolved by the Position-table specification. positionsRequired,
// postingType, and deadline are validated the same way the original
// edge-case review required.
async function create(req, res) {
  const { positionId, reportsToPositionId, positionsRequired, postingType, deadline, salaryScale,
    regulatoryDriver, category, priority,
    minimumExperienceYears, minimumEducationLevel, preferredFieldOfStudy,
    jobPurpose, essentialRequirements, desirableRequirements,
    generalKnowledge, specialSkills } = req.body;

  const position = await positionModel.findById(Number(positionId));
  if (!position) {
    return res.status(400).json({ error: 'Select a valid position' });
  }

  // postingType is now required, no silent default. Removing
  // PostingType.Open means there is no longer a safe "both" fallback to
  // reach for; HR must explicitly choose Internal or External, since that
  // choice now determines the entire eligible audience with no overlap.
  if (!postingType) {
    return res.status(400).json({ error: 'Posting type (Internal or External) is required' });
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
    postingType, // no fallback needed - already validated as required above
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
    // FIXED - a real gap found by re-checking the screening specification
    // against itself: screeningService.js reads vacancy.minimumEducationLevel
    // and vacancy.minimumExperienceYears, the schema declares them, and the
    // vacancy form collects them - but nothing here ever saved them. Every
    // vacancy's minimums would have silently stayed null regardless of what
    // HR entered, and the structured-criteria half of screening would never
    // have actually run.
    minimumExperienceYears: minimumExperienceYears ? Number(minimumExperienceYears) : null,
    minimumEducationLevel: minimumEducationLevel || null,
    preferredFieldOfStudy: preferredFieldOfStudy || null,
    positionsRequired: positionsRequired !== undefined ? Number(positionsRequired) : 1,
    // FIXED - this was never set at all, so every vacancy defaulted to
    // the schema default (previously 'Open') and was immediately visible
    // to candidates, bypassing approval entirely. The schema default is
    // now also 'PendingApproval' as a second, independent line of
    // defense - this explicit value doesn't rely on that default alone.
    status: 'PendingApproval',
    postingType, // required, validated above - no more Open fallback
    deadline: deadline ? new Date(deadline) : null,
    regulatoryDriver, category, priority,
    // Structured advert content (Job Purpose / Person Specification) -
    // all optional, normalized defensively since these arrive as nested
    // arrays/objects from the list-editor UI rather than plain scalars.
    // `?? []` rather than the `|| null` pattern used above, since an
    // explicit empty array is a valid "no items yet" value, not something
    // to be coerced to null. jobPurpose is sanitized the same way the old
    // standalone "Job description" field was - it now covers that ground
    // too (job purpose, principal accountabilities, and any other
    // narrative), pasted in as one block, so there is no separate
    // `description` field to also sanitize and save.
    jobPurpose: sanitizeJobDescription(jobPurpose),
    essentialRequirements: normalizeStringList(essentialRequirements) ?? [],
    desirableRequirements: normalizeDesirableRequirements(desirableRequirements) ?? [],
    generalKnowledge: normalizeStringList(generalKnowledge) ?? [],
    specialSkills: normalizeStringList(specialSkills) ?? [],
    createdById: req.user.id
  });
  res.status(201).json(vacancy);
}

// What CAN be edited after creation: positionsRequired (guarded against
// dropping below already-accepted offers), postingType, deadline,
// salaryScale, jobPurpose, regulatoryDriver/category/priority.
// What CANNOT: positionId, departmentId, reportsToPositionId, jobRef -
// these are fixed at creation, consistent with `title` being an
// immutable snapshot rather than a live pointer.
async function update(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const { positionsRequired, postingType, deadline, salaryScale, regulatoryDriver, category, priority,
    minimumExperienceYears, minimumEducationLevel, preferredFieldOfStudy,
    jobPurpose, essentialRequirements, desirableRequirements,
    generalKnowledge, specialSkills } = req.body;
  const fieldErrors = validateVacancyEditableFields({ positionsRequired, postingType, deadline }, { partial: true });
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });

  const data = {};
  if (postingType !== undefined) data.postingType = postingType;
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null;
  if (salaryScale !== undefined) data.salaryScale = salaryScale;
  if (regulatoryDriver !== undefined) data.regulatoryDriver = regulatoryDriver;
  if (category !== undefined) data.category = category;
  if (priority !== undefined) data.priority = priority;
  // FIXED - same gap as create(): these three were never editable either.
  // Worth being able to adjust before Begin Review fires, since screening
  // only runs at that point, not at vacancy creation.
  if (minimumExperienceYears !== undefined) data.minimumExperienceYears = minimumExperienceYears ? Number(minimumExperienceYears) : null;
  if (minimumEducationLevel !== undefined) data.minimumEducationLevel = minimumEducationLevel || null;
  if (preferredFieldOfStudy !== undefined) data.preferredFieldOfStudy = preferredFieldOfStudy || null;
  if (jobPurpose !== undefined) data.jobPurpose = sanitizeJobDescription(jobPurpose);
  const normalizedEssential = normalizeStringList(essentialRequirements);
  if (normalizedEssential !== undefined) data.essentialRequirements = normalizedEssential;
  const normalizedDesirable = normalizeDesirableRequirements(desirableRequirements);
  if (normalizedDesirable !== undefined) data.desirableRequirements = normalizedDesirable;
  const normalizedGeneralKnowledge = normalizeStringList(generalKnowledge);
  if (normalizedGeneralKnowledge !== undefined) data.generalKnowledge = normalizedGeneralKnowledge;
  const normalizedSpecialSkills = normalizeStringList(specialSkills);
  if (normalizedSpecialSkills !== undefined) data.specialSkills = normalizedSpecialSkills;

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

// SIMPLIFIED from the 5-tier flow (create -> Senior HR Officer review ->
// Principal HR Officer approve) to 2-tier: HR Officer creates, then
// either the Manager or Director role approves directly - no review step
// exists in this flow at all. Both can approve (matching real-world "MHRA
// or DHRA" practice); approvedByRole records which one specifically
// acted, so the audit trail is unambiguous even if that person's role
// changes later (the same principle already used for Vacancy.title and
// ApplicationSnapshot - a historical fact must reflect what was true at
// the time, not what is true now).
async function approve(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // Re-opening a previously Closed vacancy is still allowed - the one
  // legitimate reuse of this endpoint beyond first approval.
  if (['Open', 'PartiallyFilled', 'Filled'].includes(vacancy.status)) {
    return res.status(422).json({ error: 'This vacancy does not need approval right now' });
  }

  try {
    await workflow.assertNotSelfApproval(vacancyId, req.user.id);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const updated = await vacancyModel.update(vacancyId, {
    status: 'Open', approvedAt: new Date(), approvedById: req.user.id,
    approvedByRole: req.user.role // the role snapshot itself
  });

  // VacancyApproval can now be tracked and escalated by the SLA checker,
  // since approvedAt finally gives it a clean "resolved" signal.
  await slaModel.resolveEscalations('VacancyApproval', vacancyId);

  res.json(updated);
}

// Internal <-> External transition, bidirectional. Restricted to
// Manager/Director at the route level (the same tier as approve() -
// their being the only ones who can call this at all IS the required
// approval, the same way a single Manager/Director action already
// constitutes approval elsewhere; there is no separate propose-then-
// approve chain for this). Every transition is audited: who, when, what
// role they held, and what the value was immediately before - paired
// with an AuditLog entry (workflow.logVacancyPostingTypeTransition) for a
// full history if a vacancy transitions more than once.
async function transitionPostingType(req, res) {
  const vacancyId = Number(req.params.id);
  const { postingType } = req.body;

  if (!['Internal', 'External'].includes(postingType)) {
    return res.status(400).json({ error: 'Posting type must be Internal or External' });
  }

  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (!['Open', 'PartiallyFilled'].includes(vacancy.status)) {
    return res.status(422).json({ error: 'Only an actively open vacancy can transition posting type' });
  }
  if (vacancy.postingType === postingType) {
    return res.status(422).json({ error: `This vacancy is already ${postingType}` });
  }

  // Deliberately NOT regenerating jobRef's INT/EXT segment - jobRef is
  // generated once at creation and never changes, an existing hard rule
  // kept consistent here rather than carved out as a special case.
  //
  // Deliberately NOT touching existing Application rows either - a
  // candidate who already applied under the old posting type remains a
  // valid applicant in the same pool. Nothing in the shortlisting or
  // ranking path re-checks posting-type eligibility after submission;
  // that check only ever runs once, at the moment of submission itself.
  const updated = await vacancyModel.update(vacancyId, {
    postingType,
    postingTypePreviousValue: vacancy.postingType,
    postingTypeChangedAt: new Date(),
    postingTypeChangedById: req.user.id,
    postingTypeChangedByRole: req.user.role
  });

  await workflow.logVacancyPostingTypeTransition(vacancyId, vacancy.postingType, postingType, req.user.id);

  res.json(updated);
}

// candidateType comes from a verified JWT (req.user, set only by
// optionalAuthenticate if a valid token was presented), never from a
// client-supplied query string - closes the access-control gap found
// during the original edge-case review. Default is the safe (External)
// filter unless a genuinely verified Internal candidate says otherwise.
// CHANGED - strict bidirectional match, not just a one-way block.
// PostingType.Open no longer exists, so a vacancy is now always exactly
// Internal or External, never both - an Internal (staff) account only
// ever sees Internal vacancies; an External account only ever sees
// External ones. This is the same rule submit()/saveDraft() enforce at
// application time (see applicationEligibility.js) - a candidate can
// never even see a vacancy they wouldn't be allowed to apply to.
async function listPublic(req, res) {
  const candidateType = req.user?.type === 'candidate' ? req.user.candidateType : 'External';
  const postingType = candidateType === 'Internal' ? 'Internal' : 'External';

  const vacancies = await vacancyModel.findManyWithDetails({
    status: { in: ['Open', 'PartiallyFilled'] },
    postingType
  });
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

module.exports = { create, update, close, approve, transitionPostingType, listPublic, listForAdmin, getOne, listApplications, saveRanking };
