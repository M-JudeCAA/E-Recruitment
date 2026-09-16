const prisma = require('../config/db');
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
  normalizeStringList, normalizeDesirableRequirements, normalizeDisqualifyingRequirements, normalizeRequiredExamGrades
} = require('../utils/vacancyValidation');

// Shared by create() and readvertise() below - both construct a full
// Vacancy row the same way (same fields, same normalization), differing
// only in where positionId/reportsToPositionId/jobRef/status/
// readvertisedFromId come from. position and reportsToPositionId are
// passed in already-resolved/validated by the caller, never re-derived
// from body here.
function buildVacancyCreateData(position, reportsToPositionId, body, createdById) {
  const { postingType, deadline, salaryScale, regulatoryDriver, category, priority,
    minimumExperienceYears, minimumEducationLevel, preferredFieldOfStudy,
    minimumAge, maximumAge, minimumFlyingHours, minimumCGPA, requiredExamGrades,
    jobPurpose, essentialRequirements, desirableRequirements, disqualifyingRequirements,
    generalKnowledge, specialSkills,
    location, employmentCategory, internalSalaryRange, recruiterNotes,
    positionsRequired } = body;

  return {
    title: position.name, // immutable snapshot - protects history if Position is renamed later
    positionId: position.id,
    departmentId: position.departmentId, // derived, never independently supplied
    reportsToPositionId,
    salaryScale: salaryScale || null,
    minimumExperienceYears: minimumExperienceYears ? Number(minimumExperienceYears) : null,
    minimumEducationLevel: minimumEducationLevel || null,
    preferredFieldOfStudy: preferredFieldOfStudy || null,
    minimumAge: minimumAge ? Number(minimumAge) : null,
    maximumAge: maximumAge ? Number(maximumAge) : null,
    minimumFlyingHours: minimumFlyingHours ? Number(minimumFlyingHours) : null,
    minimumCGPA: minimumCGPA ? Number(minimumCGPA) : null,
    requiredExamGrades: normalizeRequiredExamGrades(requiredExamGrades) ?? [],
    positionsRequired: positionsRequired !== undefined ? Number(positionsRequired) : 1,
    postingType, // required, validated by the caller - no more Open fallback
    deadline: deadline ? new Date(deadline) : null,
    regulatoryDriver, category, priority,
    // Structured advert content (Job Purpose / Person Specification) -
    // all optional, normalized defensively since these arrive as nested
    // arrays/objects from the list-editor UI rather than plain scalars.
    // `?? []` rather than the `|| null` pattern used above, since an
    // explicit empty array is a valid "no items yet" value, not something
    // to be coerced to null.
    jobPurpose: sanitizeJobDescription(jobPurpose),
    essentialRequirements: normalizeStringList(essentialRequirements) ?? [],
    desirableRequirements: normalizeDesirableRequirements(desirableRequirements) ?? [],
    disqualifyingRequirements: normalizeDisqualifyingRequirements(disqualifyingRequirements) ?? [],
    generalKnowledge: normalizeStringList(generalKnowledge) ?? [],
    specialSkills: normalizeStringList(specialSkills) ?? [],
    location: location || null,
    employmentCategory: employmentCategory || null,
    internalSalaryRange: internalSalaryRange || null,
    recruiterNotes: recruiterNotes || null,
    createdById
  };
}

// Title/Department come from the selected Position, not free text -
// resolved by the Position-table specification. positionsRequired,
// postingType, and deadline are validated the same way the original
// edge-case review required.
async function create(req, res) {
  const { positionId, reportsToPositionId, postingType, deadline, positionsRequired,
    employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA } = req.body;

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

  const fieldErrors = validateVacancyEditableFields({
    positionsRequired, postingType, deadline, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA
  });
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
    // FIXED - this was never set at all, so every vacancy defaulted to
    // the schema default (previously 'Open') and was immediately visible
    // to candidates, bypassing approval entirely. The schema default is
    // now also 'PendingApproval' as a second, independent line of
    // defense - this explicit value doesn't rely on that default alone.
    status: 'PendingApproval',
    ...buildVacancyCreateData(position, validatedReportsToId, req.body, req.user.id)
  });
  res.status(201).json(vacancy);
}

// Re-runs a closed vacancy as a brand new Vacancy row (own jobRef, goes
// through PendingApproval -> approve again) rather than reopening the same
// row in place - the closed original's applications/offers/rejections stay
// untouched as a clean historical record, same reasoning as every other
// snapshot-not-mutation field on this model (see the schema comment on
// readvertisedFromId). positionId/reportsToPositionId are inherited from
// the original, never re-picked here - same "fixed at creation" rule the
// HRDashboard edit modal already documents; everything else (postingType,
// deadline, salary, the full advert content...) is exactly as editable as
// it is on a fresh create(), since the frontend pre-fills a form from the
// closed vacancy's own values and HR can change any of them before
// submitting.
async function readvertise(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (vacancy.status !== 'Closed') {
    return res.status(422).json({ error: 'Only a closed vacancy can be readvertised' });
  }

  const { postingType, positionsRequired, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA, deadline } = req.body;
  if (!postingType) {
    return res.status(400).json({ error: 'Posting type (Internal or External) is required' });
  }
  const fieldErrors = validateVacancyEditableFields({
    positionsRequired, postingType, deadline, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA
  });
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });

  // Re-fetched rather than trusting the closed row's own title/department -
  // if the underlying Position was renamed/moved since, the readvertised
  // posting should snapshot what's true now, exactly as create() does for
  // any brand new vacancy against this same position.
  const position = await positionModel.findById(vacancy.positionId);
  if (!position) {
    return res.status(400).json({ error: 'The position behind this vacancy no longer exists' });
  }

  const jobRef = await generateJobRef(
    postingType,
    new Date(),
    (prefix) => vacancyModel.countByJobRefPrefix(prefix)
  );

  const created = await vacancyModel.create({
    jobRef,
    status: 'PendingApproval',
    readvertisedFromId: vacancy.id,
    ...buildVacancyCreateData(position, vacancy.reportsToPositionId, req.body, req.user.id)
  });
  res.status(201).json(created);
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
    minimumAge, maximumAge, minimumFlyingHours, minimumCGPA, requiredExamGrades,
    jobPurpose, essentialRequirements, desirableRequirements, disqualifyingRequirements,
    generalKnowledge, specialSkills,
    location, employmentCategory, internalSalaryRange, recruiterNotes } = req.body;
  const fieldErrors = validateVacancyEditableFields({
    positionsRequired, postingType, deadline, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA
  }, { partial: true });
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
  if (minimumAge !== undefined) data.minimumAge = minimumAge ? Number(minimumAge) : null;
  if (maximumAge !== undefined) data.maximumAge = maximumAge ? Number(maximumAge) : null;
  if (minimumFlyingHours !== undefined) data.minimumFlyingHours = minimumFlyingHours ? Number(minimumFlyingHours) : null;
  if (minimumCGPA !== undefined) data.minimumCGPA = minimumCGPA ? Number(minimumCGPA) : null;
  const normalizedExamGrades = normalizeRequiredExamGrades(requiredExamGrades);
  if (normalizedExamGrades !== undefined) data.requiredExamGrades = normalizedExamGrades;
  if (jobPurpose !== undefined) data.jobPurpose = sanitizeJobDescription(jobPurpose);
  const normalizedEssential = normalizeStringList(essentialRequirements);
  if (normalizedEssential !== undefined) data.essentialRequirements = normalizedEssential;
  const normalizedDesirable = normalizeDesirableRequirements(desirableRequirements);
  if (normalizedDesirable !== undefined) data.desirableRequirements = normalizedDesirable;
  const normalizedDisqualifying = normalizeDisqualifyingRequirements(disqualifyingRequirements);
  if (normalizedDisqualifying !== undefined) data.disqualifyingRequirements = normalizedDisqualifying;
  const normalizedGeneralKnowledge = normalizeStringList(generalKnowledge);
  if (normalizedGeneralKnowledge !== undefined) data.generalKnowledge = normalizedGeneralKnowledge;
  const normalizedSpecialSkills = normalizeStringList(specialSkills);
  if (normalizedSpecialSkills !== undefined) data.specialSkills = normalizedSpecialSkills;
  if (location !== undefined) data.location = location || null;
  if (employmentCategory !== undefined) data.employmentCategory = employmentCategory || null;
  if (internalSalaryRange !== undefined) data.internalSalaryRange = internalSalaryRange || null;
  if (recruiterNotes !== undefined) data.recruiterNotes = recruiterNotes || null;

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
  // Approving (or re-opening) a vacancy whose deadline has already passed
  // would publish it in a state that can never accept an application -
  // candidates are blocked from applying the moment the deadline lapses
  // (see the "deadline passed" handling in applicationEligibility.js),
  // regardless of Vacancy.status. HR needs to push the deadline out first.
  if (vacancy.deadline && vacancy.deadline < new Date()) {
    return res.status(422).json({ error: 'This vacancy\'s deadline has already passed - extend the deadline before approving it' });
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
  const { postingType, deadline } = req.body;

  if (!['Internal', 'External'].includes(postingType)) {
    return res.status(400).json({ error: 'Posting type must be Internal or External' });
  }

  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // Locked once a transition has already been made while the deadline had
  // already passed - see the schema comment on postingTypeLocked. A
  // pre-deadline transition never sets this, so this vacancy can still
  // flip back and forth freely up until the first post-deadline one.
  if (vacancy.postingTypeLocked) {
    return res.status(422).json({ error: "This vacancy's posting type is locked and can no longer be changed" });
  }
  if (!['Open', 'PartiallyFilled'].includes(vacancy.status)) {
    return res.status(422).json({ error: 'Only an actively open vacancy can transition posting type' });
  }
  if (vacancy.postingType === postingType) {
    return res.status(422).json({ error: `This vacancy is already ${postingType}` });
  }

  // Every transition prompts HR (client-side) to extend the deadline or
  // leave it as-is. Only re-validate "not in the past" when it's actually
  // being changed - re-sending the vacancy's own already-past deadline
  // unchanged (the "kept as is" choice) must still be accepted.
  const currentDeadlineTime = vacancy.deadline ? vacancy.deadline.getTime() : null;
  const newDeadline = deadline !== undefined ? (deadline ? new Date(deadline) : null) : undefined;
  const deadlineChanged = newDeadline !== undefined && (newDeadline?.getTime() ?? null) !== currentDeadlineTime;
  if (deadlineChanged) {
    const fieldErrors = validateVacancyEditableFields({ deadline });
    if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });
  }

  // Read before any deadline change this same request makes - a
  // transition that itself extends a passed deadline still counts as
  // "made while the deadline had passed" and locks the vacancy.
  const wasDeadlinePassed = vacancy.deadline && vacancy.deadline < new Date();

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
    postingTypeChangedByRole: req.user.role,
    postingTypeLocked: wasDeadlinePassed ? true : vacancy.postingTypeLocked,
    ...(newDeadline !== undefined ? { deadline: newDeadline } : {})
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
// A deadline-passed vacancy is still returned here, deliberately - the
// frontend tags it "Closed" and swaps its Apply button for a "Download job
// details" one (still-visible advert, no more new applications), rather
// than the listing hiding it outright. Vacancy.status is never mutated
// just because a deadline lapsed (see its own comment: status reflects
// fill-count, not time) - a manually status:Closed/Filled vacancy is a
// separate, unrelated case still excluded by the status filter below.
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
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(400).json({ error: 'Invalid vacancy id' });
  const applications = await applicationModel.findByVacancy(vacancyId);
  res.json(applications);
}

async function saveRanking(req, res) {
  const vacancyId = Number(req.params.id);
  const { applicationIds, applicationRankVersions } = req.body;

  if (!Array.isArray(applicationIds) || applicationIds.length === 0 || !applicationIds.every(Number.isInteger)) {
    return res.status(400).json({ error: 'applicationIds must be a non-empty array of application ids' });
  }
  const uniqueIds = [...new Set(applicationIds)];
  if (uniqueIds.length !== applicationIds.length) {
    return res.status(400).json({ error: 'applicationIds contains a duplicate application id' });
  }
  // applicationRankVersions: { [applicationId]: rankVersion } - the version
  // of every application the client's own copy of the ranking was built
  // from. Required (not optional) so there's no silent bypass path - every
  // id in applicationIds must have a corresponding integer version.
  if (typeof applicationRankVersions !== 'object' || applicationRankVersions === null
    || !uniqueIds.every((id) => Number.isInteger(applicationRankVersions[id]))) {
    return res.status(400).json({ error: 'applicationRankVersions must include an integer rankVersion for every application id' });
  }

  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // Every id must actually belong to this vacancy - without this, a
  // crafted/stale request could rank an application that belongs to a
  // completely different vacancy (assertCanShortlist only checks internal-
  // verification status, not vacancy ownership).
  const owned = await prisma.application.findMany({ where: { id: { in: uniqueIds }, vacancyId }, select: { id: true, rankVersion: true } });
  if (owned.length !== uniqueIds.length) {
    return res.status(400).json({ error: 'One or more application ids do not belong to this vacancy' });
  }
  // Optimistic-concurrency check - if any application's rankVersion has
  // moved on since the client loaded it (another HR user's ranking write,
  // a shortlist() call, anything), the whole batch is rejected rather than
  // silently overwriting a ranking decision made after this client's load.
  const staleApp = owned.find((a) => a.rankVersion !== applicationRankVersions[a.id]);
  if (staleApp) {
    return res.status(409).json({ error: 'The ranking has changed since you loaded it - please refresh and try again' });
  }

  const rankData = [];
  for (let i = 0; i < applicationIds.length; i++) {
    const appId = applicationIds[i];
    try {
      await workflow.assertCanShortlist(appId);
    } catch (err) {
      return res.status(422).json({ error: `Application ${appId}: ${err.message}` });
    }
    const listStatus = i < vacancy.positionsRequired ? 'Primary' : 'Reserve';
    rankData.push({ id: appId, rank: i + 1, listStatus });
  }

  // All-or-nothing - a plain Promise.all of independent updates could leave
  // the ranking half-committed if one write failed partway through (e.g. a
  // row deleted between the guard check above and the write itself).
  const results = await prisma.$transaction(
    rankData.map(({ id, rank, listStatus }) =>
      prisma.application.update({ where: { id }, data: { rank, listStatus, status: 'Shortlisted', rankVersion: { increment: 1 } } })
    )
  );
  res.json(results);
}

module.exports = { create, update, close, approve, transitionPostingType, readvertise, listPublic, listForAdmin, getOne, listApplications, saveRanking };
