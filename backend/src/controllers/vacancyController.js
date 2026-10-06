const conflictOfInterest = require('../services/conflictOfInterestService');
const { sendError, classifyError } = require('../utils/errorResponse');
const prisma = require('../config/db');
const vacancyModel = require('../models/vacancyModel');
const vacancyDraftModel = require('../models/vacancyDraftModel');
const applicationModel = require('../models/applicationModel');
const positionModel = require('../models/positionModel');
const offerModel = require('../models/offerModel');
const workflow = require('../services/workflowService');
const audit = require('../services/auditService');
const slaModel = require('../models/slaModel');
const { notify } = require('../services/notificationService');
const requisitionService = require('../services/requisitionService');
const hiringManagers = require('../services/hiringManagerService');
const duplicateApplicants = require('../services/duplicateApplicantService');
const accessLog = require('../services/accessLogService');
const { sendRequisitionError } = require('./requisitionController');
const headcount = require('../services/headcountService');
const vacancyProgress = require('../services/vacancyProgressService');
const { ROLE_RANK } = require('../middleware/auth');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { toPublicVacancy } = require('../utils/publicVacancy');
const { escapeHtml } = require('../utils/interviewFormat');
const { sanitizeJobDescription } = require('../utils/htmlSanitizer');
const {
  validateVacancyEditableFields, screeningQuestionCountError,
  normalizeStringList, normalizeDesirableRequirements, normalizeDisqualifyingRequirements, normalizeRequiredExamGrades
} = require('../utils/vacancyValidation');

// Statuses a vacancy must be in for candidates and guests to see it.
const PUBLIC_STATUSES = ['Open', 'PartiallyFilled'];

// Which posting type a non-staff viewer may see. Derived only from the
// verified token, never from anything the client sends; an anonymous
// visitor is treated as External.
function viewerPostingType(user) {
  return user?.type === 'candidate' && user.candidateType === 'Internal' ? 'Internal' : 'External';
}

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
    generalKnowledge, specialSkills, desirableQualifications,
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
    desirableQualifications: normalizeStringList(desirableQualifications) ?? [],
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
  const questionError = screeningQuestionCountError(
    normalizeDesirableRequirements(req.body.desirableRequirements), normalizeDisqualifyingRequirements(req.body.disqualifyingRequirements)
  );
  if (questionError) fieldErrors.push(questionError);
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

  let hiringManager = {};
  if (req.body.hiringManager !== undefined) {
    const parsed = hiringManagers.parseHiringManager(req.body.hiringManager);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    hiringManager = parsed.data;
  }

  // Only from an uploaded, EXCO-approved requisition - re-read from the
  // stored document here, never taken from the request.
  let requisition;
  try {
    requisition = await requisitionService.forCreate(req.body, req.user.id);
    // Within the approved headcount, or an exception with a reason that a
    // Director authorises at approval (FR-ATS-006).
    const headcountException = await headcount.exceptionFor(position.id, Number(req.body.positionsRequired) || 1, req.body.headcountExceptionReason, req.user.id);
    if (headcountException) requisition.requisitionDetails = { ...requisition.requisitionDetails, headcountException };
  } catch (err) {
    return sendRequisitionError(res, err);
  }

  let vacancy;
  try {
    vacancy = await vacancyModel.createWithJobRef(postingType, {
    ...requisition,
    // FIXED - this was never set at all, so every vacancy defaulted to
    // the schema default (previously 'Open') and was immediately visible
    // to candidates, bypassing approval entirely. The schema default is
    // now also 'PendingApproval' as a second, independent line of
    // defense - this explicit value doesn't rely on that default alone.
    status: 'PendingApproval',
    ...hiringManager,
    ...buildVacancyCreateData(position, validatedReportsToId, req.body, req.user.id)
    });
  } catch (err) {
    // The same requisition submitted twice at once - the unique hash lets
    // only one through.
    if (err.code === 'P2002' && String(err.meta?.target || '').includes('requisitionDocumentHash')) {
      return res.status(409).json({ error: 'This requisition has just been used for another vacancy.', code: 'DUPLICATE_REQUISITION' });
    }
    throw err;
  }
  // The draft it was written in has served its purpose.
  const draftId = Number(req.body.draftId);
  if (Number.isInteger(draftId) && draftId > 0) {
    await vacancyDraftModel.removeMine(draftId, req.user.id).catch((err) => console.error(`Failed to remove vacancy draft ${draftId}:`, err));
  }
  await audit.record({
    entityType: 'Vacancy', entityId: vacancy.id, action: 'Vacancy created', actor: audit.actorFrom(req),
    details: {
      jobRef: vacancy.jobRef,
      requisition: requisition.requisitionDocumentName,
      editedFromRequisition: requisition.requisitionDetails.editedFields
    }
  });
  broadcastDashboardEvent('VacancyPendingApproval', { vacancyId: vacancy.id });
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
  const questionError = screeningQuestionCountError(
    normalizeDesirableRequirements(req.body.desirableRequirements), normalizeDisqualifyingRequirements(req.body.disqualifyingRequirements)
  );
  if (questionError) fieldErrors.push(questionError);
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });
  let readvertiseHiringManager = {};
  if (req.body.hiringManager !== undefined) {
    const parsed = hiringManagers.parseHiringManager(req.body.hiringManager);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    readvertiseHiringManager = parsed.data;
  }

  // Re-fetched rather than trusting the closed row's own title/department -
  // if the underlying Position was renamed/moved since, the readvertised
  // posting should snapshot what's true now, exactly as create() does for
  // any brand new vacancy against this same position.
  const position = await positionModel.findById(vacancy.positionId);
  if (!position) {
    return res.status(400).json({ error: 'The position behind this vacancy no longer exists' });
  }

  const carried = requisitionService.carriedOver(vacancy);
  let headcountException;
  try {
    headcountException = await headcount.exceptionFor(position.id, Number(positionsRequired) || 1, req.body.headcountExceptionReason, req.user.id);
  } catch (err) {
    return sendRequisitionError(res, err);
  }
  const { headcountException: _old, ...carriedDetails } = carried.requisitionDetails || {};
  carried.requisitionDetails = { ...carriedDetails, ...(headcountException ? { headcountException } : {}) };

  const created = await vacancyModel.createWithJobRef(postingType, {
    status: 'PendingApproval',
    readvertisedFromId: vacancy.id,
    // Re-running the same approved position - same requisition.
    ...carried,
    // The same hiring manager, unless HR names another.
    hiringManagerName: vacancy.hiringManagerName, hiringManagerEmail: vacancy.hiringManagerEmail,
    hiringManagerEntraId: vacancy.hiringManagerEntraId, hiringManagerJobTitle: vacancy.hiringManagerJobTitle,
    ...readvertiseHiringManager,
    ...buildVacancyCreateData(position, vacancy.reportsToPositionId, req.body, req.user.id)
  });
  await audit.record({
    entityType: 'Vacancy', entityId: created.id, action: 'Vacancy created (readvertisement)', actor: audit.actorFrom(req),
    details: { jobRef: created.jobRef, readvertisedFromId: vacancy.id }
  });
  await audit.record({
    entityType: 'Vacancy', entityId: vacancy.id, action: 'Vacancy readvertised', actor: audit.actorFrom(req),
    details: { readvertisedAsId: created.id, jobRef: created.jobRef }
  });
  broadcastDashboardEvent('VacancyPendingApproval', { vacancyId: created.id });
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
    generalKnowledge, specialSkills, desirableQualifications,
    location, employmentCategory, internalSalaryRange, recruiterNotes } = req.body;
  const fieldErrors = validateVacancyEditableFields({
    positionsRequired, postingType, deadline, employmentCategory, minimumAge, maximumAge, minimumFlyingHours, minimumCGPA
  }, { partial: true });
  const countOf = (list) => (Array.isArray(list) ? list.length : 0);
  const nextDesirable = normalizeDesirableRequirements(desirableRequirements) ?? vacancy.desirableRequirements;
  const nextDisqualifying = normalizeDisqualifyingRequirements(disqualifyingRequirements) ?? vacancy.disqualifyingRequirements;
  const questionError = screeningQuestionCountError(nextDesirable, nextDisqualifying,
    countOf(vacancy.desirableRequirements) + countOf(vacancy.disqualifyingRequirements));
  if (questionError) fieldErrors.push(questionError);
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });

  if (vacancy.status === 'Rejected') return res.status(422).json({ error: 'A rejected vacancy can no longer be edited' });

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
  const normalizedDesirableQualifications = normalizeStringList(desirableQualifications);
  if (normalizedDesirableQualifications !== undefined) data.desirableQualifications = normalizedDesirableQualifications;
  if (location !== undefined) data.location = location || null;
  if (employmentCategory !== undefined) data.employmentCategory = employmentCategory || null;
  if (internalSalaryRange !== undefined) data.internalSalaryRange = internalSalaryRange || null;
  if (recruiterNotes !== undefined) data.recruiterNotes = recruiterNotes || null;
  if (req.body.hiringManager !== undefined) {
    const parsed = hiringManagers.parseHiringManager(req.body.hiringManager);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    Object.assign(data, parsed.data);
  }

  if (positionsRequired !== undefined) {
    const n = Number(positionsRequired);
    const acceptedCount = await offerModel.countAccepted(vacancyId);
    if (n < acceptedCount) {
      return res.status(422).json({
        error: `Cannot reduce positions required below ${acceptedCount}, the number of offers already accepted for this vacancy`
      });
    }
    data.positionsRequired = n;
    if (n > vacancy.positionsRequired) {
      // More posts than before: within headcount, or an exception. Before
      // approval the approver authorises it; on a published vacancy only a
      // Director may raise it, which authorises it there and then.
      let exception;
      try {
        exception = await headcount.exceptionFor(vacancy.positionId, n, req.body.headcountExceptionReason, req.user.id, vacancyId);
      } catch (err) {
        return sendRequisitionError(res, err);
      }
      if (exception) {
        const approved = !['PendingApproval', 'Returned'].includes(vacancy.status);
        if (approved && (ROLE_RANK[req.user.role] || 0) < ROLE_RANK.Director) {
          return res.status(403).json({ error: 'Raising a published vacancy above the approved headcount needs a Director', code: 'HEADCOUNT_EXCEPTION_NEEDS_DIRECTOR' });
        }
        data.requisitionDetails = {
          ...(vacancy.requisitionDetails || {}),
          headcountException: approved
            ? { ...exception, authorisedById: req.user.id, authorisedByRole: req.user.role, authorisedAt: new Date().toISOString() }
            : exception
        };
      }
    }
  }

  // Moving the deadline of a vacancy candidates can already see - extending
  // or shortening it - needs a reason (FR-ATS-027). Before approval it's
  // just drafting.
  // Compared by calendar day: the edit form sends a plain date, and
  // re-saving an untouched form must not count as moving the deadline.
  const dayOf = (d) => (d ? d.toISOString().slice(0, 10) : null);
  const deadlineMoved = data.deadline !== undefined && dayOf(data.deadline) !== dayOf(vacancy.deadline);
  const published = ['Open', 'PartiallyFilled', 'Filled', 'Closed'].includes(vacancy.status);
  const reason = reasonFrom(req.body);
  if (deadlineMoved && published && !reason) {
    return res.status(400).json({ error: 'Give a reason for changing the deadline of a published vacancy' });
  }

  const updated = await vacancyModel.update(vacancyId, data);
  await audit.record({
    entityType: 'Vacancy', entityId: vacancyId,
    action: deadlineMoved && published
      ? (vacancy.deadline && data.deadline && data.deadline > vacancy.deadline ? 'Vacancy deadline extended' : 'Vacancy deadline changed')
      : 'Vacancy edited',
    actor: audit.actorFrom(req), before: vacancy, after: updated, fields: Object.keys(data), comment: reason
  });
  res.json(updated);
}

// A comment is mandatory wherever an approver says no, and when a vacancy
// is closed or its published deadline moved (BR-ATS-07, FR-ATS-027).
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 2000;
function reasonFrom(body) {
  const text = typeof body?.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON_LENGTH) : '';
  return text.length >= MIN_REASON_LENGTH ? text : null;
}

// Loads the vacancy for an approver's decision; answers and returns null
// if it isn't awaiting approval.
async function loadPendingApproval(req, res, verb) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) { res.status(404).json({ error: 'Vacancy not found' }); return null; }
  if (vacancy.status !== 'PendingApproval') {
    res.status(422).json({ error: `Only a vacancy awaiting approval can be ${verb}` });
    return null;
  }
  return vacancy;
}

function describeVacancy(vacancy) {
  return `${vacancy.jobRef} (${vacancy.title})`;
}

// Notices are a side effect of a decision that already committed.
async function notifySafely(recipientId, taskType, taskId, message) {
  try {
    await notify(recipientId, taskType, taskId, message);
  } catch (err) {
    console.error(`Failed to send ${taskType} notice for vacancy ${taskId}:`, err);
  }
}

// PATCH /api/vacancies/:id/return - Manager+ sends a vacancy awaiting
// approval back to HR with what needs to change. HR edits it and
// resubmits it (below); the edits and the comment are in its history.
async function returnForRevision(req, res) {
  const vacancy = await loadPendingApproval(req, res, 'returned');
  if (!vacancy) return;
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: 'Say what needs to change before this vacancy can be approved' });

  const now = new Date();
  const result = await vacancyModel.updateIfStatus(vacancy.id, 'PendingApproval', { status: 'Returned', returnedAt: now, returnReason: reason });
  if (result.count === 0) return res.status(409).json({ error: 'This vacancy was already updated - please refresh and try again' });
  await slaModel.resolveEscalations('VacancyApproval', vacancy.id);
  await audit.record({
    entityType: 'Vacancy', entityId: vacancy.id, action: 'Vacancy returned for revision', actor: audit.actorFrom(req),
    before: vacancy, after: { status: 'Returned' }, fields: ['status'], comment: reason
  });
  await notifySafely(vacancy.createdById, 'VacancyReturned', vacancy.id,
    `${describeVacancy(vacancy)} was returned for revision: ${escapeHtml(reason)}. Edit it and resubmit it for approval.`);
  broadcastDashboardEvent('VacancyReturned', { vacancyId: vacancy.id });
  res.json(await vacancyModel.findById(vacancy.id));
}

// PATCH /api/vacancies/:id/reject - Manager+ refuses a vacancy outright.
// Final: a rejected vacancy can't be resubmitted or approved.
async function reject(req, res) {
  const vacancy = await loadPendingApproval(req, res, 'rejected');
  if (!vacancy) return;
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: 'A reason is required to reject a vacancy' });

  const result = await vacancyModel.updateIfStatus(vacancy.id, 'PendingApproval', {
    status: 'Rejected', rejectedAt: new Date(), rejectionReason: reason
  });
  if (result.count === 0) return res.status(409).json({ error: 'This vacancy was already updated - please refresh and try again' });
  await slaModel.resolveEscalations('VacancyApproval', vacancy.id);
  await audit.record({
    entityType: 'Vacancy', entityId: vacancy.id, action: 'Vacancy rejected', actor: audit.actorFrom(req),
    before: vacancy, after: { status: 'Rejected' }, fields: ['status'], comment: reason
  });
  await notifySafely(vacancy.createdById, 'VacancyRejected', vacancy.id,
    `${describeVacancy(vacancy)} was rejected: ${escapeHtml(reason)}`);
  await hiringManagers.notify(vacancy, 'closed', { reason: `it was not approved for advertising (${reason})` });
  broadcastDashboardEvent('VacancyRejected', { vacancyId: vacancy.id });
  res.json(await vacancyModel.findById(vacancy.id));
}

// PATCH /api/vacancies/:id/resubmit - HR puts a returned vacancy back for
// approval once it has been revised. The approval clock restarts.
async function resubmit(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });
  if (vacancy.status !== 'Returned') return res.status(422).json({ error: 'Only a returned vacancy can be resubmitted' });
  if (vacancy.deadline && vacancy.deadline < new Date()) {
    return res.status(422).json({ error: 'This vacancy\'s deadline has already passed - extend the deadline before resubmitting it' });
  }

  const result = await vacancyModel.updateIfStatus(vacancyId, 'Returned', { status: 'PendingApproval', approvalRequestedAt: new Date() });
  if (result.count === 0) return res.status(409).json({ error: 'This vacancy was already updated - please refresh and try again' });
  await audit.record({
    entityType: 'Vacancy', entityId: vacancyId, action: 'Vacancy resubmitted for approval', actor: audit.actorFrom(req),
    before: vacancy, after: { status: 'PendingApproval' }, fields: ['status'], comment: reasonFrom(req.body)
  });
  broadcastDashboardEvent('VacancyPendingApproval', { vacancyId });
  res.json(await vacancyModel.findById(vacancyId));
}

// PATCH /api/vacancies/:id/close - takes a vacancy off the jobs board (the
// "unpublish" of FR-ATS-027). A closed vacancy can be re-opened through
// approve(). The reason is required and kept on the row and in the history.
const CLOSABLE_STATUSES = ['PendingApproval', 'Open', 'PartiallyFilled', 'Filled'];

async function close(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  if (vacancy.status === 'Closed') {
    return res.status(422).json({ error: 'This vacancy is already closed' });
  }
  if (!CLOSABLE_STATUSES.includes(vacancy.status)) {
    return res.status(422).json({ error: `A ${vacancy.status.toLowerCase()} vacancy cannot be closed` });
  }
  const reason = reasonFrom(req.body);
  if (!reason) return res.status(400).json({ error: 'A reason is required to close a vacancy' });

  const result = await vacancyModel.updateIfStatus(vacancyId, vacancy.status, { status: 'Closed', closedAt: new Date(), closeReason: reason });
  if (result.count === 0) return res.status(409).json({ error: 'This vacancy was already updated - please refresh and try again' });
  if (vacancy.status === 'PendingApproval') await slaModel.resolveEscalations('VacancyApproval', vacancyId);
  await audit.record({
    entityType: 'Vacancy', entityId: vacancyId, action: 'Vacancy closed', actor: audit.actorFrom(req),
    before: vacancy, after: { status: 'Closed' }, fields: ['status'], comment: reason
  });
  await hiringManagers.notify(vacancy, 'closed', { reason });
  broadcastDashboardEvent('VacancyClosed', { vacancyId });
  res.json(await vacancyModel.findById(vacancyId));
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
// A Director's authority through an active delegation (the route itself
// is Manager+).
async function actsAsDirector(req) {
  const delegationModel = require('../models/delegationModel');
  const delegation = await delegationModel.findActiveForDelegate(req.user.id, new Date());
  if (delegation && (ROLE_RANK[delegation.delegator.role] || 0) >= ROLE_RANK.Director) {
    await delegationModel.logUsage(delegation.id, `${req.method} ${req.originalUrl} (headcount exception)`);
    req.actingAsDelegateFor = delegation.delegatorId;
    return true;
  }
  return false;
}

async function approve(req, res) {
  const vacancyId = Number(req.params.id);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  // Re-opening a previously Closed vacancy is still allowed - the one
  // legitimate reuse of this endpoint beyond first approval. A Returned
  // vacancy must be resubmitted first; a Rejected one is final.
  if (!['PendingApproval', 'Closed'].includes(vacancy.status)) {
    const why = vacancy.status === 'Returned' ? 'It was returned for revision - HR needs to resubmit it first'
      : vacancy.status === 'Rejected' ? 'It was rejected' : 'It does not need approval right now';
    return res.status(422).json({ error: `This vacancy can't be approved. ${why}.` });
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
    return sendError(res, err, 422);
  }

  // FR-ATS-018: created on a job description that isn't approved - the
  // approver authorises that exception explicitly, and it is recorded.
  const jdException = vacancy.requisitionDetails?.jdException;
  const needsJdAuthorisation = jdException && !jdException.authorisedAt;
  if (needsJdAuthorisation && req.body?.authoriseJdException !== true) {
    return res.status(422).json({
      error: `This vacancy was created on a job description that is not approved (reason given: ${jdException.reason}). `
        + 'Approving it authorises that exception - confirm to go ahead.',
      code: 'JD_EXCEPTION_NOT_AUTHORISED'
    });
  }

  // FR-ATS-006: more posts than the approved headcount leaves - only a
  // Director authorises that, explicitly.
  const headcountException = vacancy.requisitionDetails?.headcountException;
  const needsHeadcountAuthorisation = headcountException && !headcountException.authorisedAt;
  if (needsHeadcountAuthorisation) {
    if ((ROLE_RANK[req.user.role] || 0) < ROLE_RANK.Director && !(await actsAsDirector(req))) {
      return res.status(403).json({
        error: `This vacancy is above the approved headcount (reason given: ${headcountException.reason}) - a Director must approve it.`,
        code: 'HEADCOUNT_EXCEPTION_NEEDS_DIRECTOR'
      });
    }
    if (req.body?.authoriseHeadcountException !== true) {
      return res.status(422).json({
        error: `This vacancy asks for ${headcountException.requested} post(s) where the approved headcount left ${headcountException.available} `
          + `(reason given: ${headcountException.reason}). Approving it authorises that exception - confirm to go ahead.`,
        code: 'HEADCOUNT_EXCEPTION_NOT_AUTHORISED'
      });
    }
  }
  const stamp = { authorisedById: req.user.id, authorisedByRole: req.user.role, authorisedAt: new Date().toISOString() };

  const result = await vacancyModel.updateIfStatus(vacancyId, vacancy.status, {
    status: 'Open', approvedAt: new Date(), approvedById: req.user.id,
    approvedByRole: req.user.role, // the role snapshot itself
    ...(needsJdAuthorisation || needsHeadcountAuthorisation ? {
      requisitionDetails: {
        ...vacancy.requisitionDetails,
        ...(needsJdAuthorisation ? { jdException: { ...jdException, ...stamp } } : {}),
        ...(needsHeadcountAuthorisation ? { headcountException: { ...headcountException, ...stamp } } : {})
      }
    } : {})
  });
  if (result.count === 0) return res.status(409).json({ error: 'This vacancy was already updated - please refresh and try again' });
  const updated = await vacancyModel.findById(vacancyId);

  // VacancyApproval can now be tracked and escalated by the SLA checker,
  // since approvedAt finally gives it a clean "resolved" signal.
  await slaModel.resolveEscalations('VacancyApproval', vacancyId);
  await audit.record({
    entityType: 'Vacancy', entityId: vacancyId,
    action: vacancy.status === 'Closed' ? 'Vacancy re-opened' : 'Vacancy approved', actor: audit.actorFrom(req),
    before: vacancy, after: updated, fields: ['status'],
    ...(needsJdAuthorisation || needsHeadcountAuthorisation ? {
      comment: [
        needsJdAuthorisation && `Authorised the exception for an unapproved job description: ${jdException.reason}`,
        needsHeadcountAuthorisation && `Authorised going above the approved headcount: ${headcountException.reason}`
      ].filter(Boolean).join(' ')
    } : {})
  });

  await hiringManagers.notify(updated, 'published');
  broadcastDashboardEvent('VacancyApproved', { vacancyId });
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
  if (newDeadline !== undefined) {
    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action: 'Vacancy edited', actor: audit.actorFrom(req),
      before: vacancy, after: updated, fields: ['deadline', 'postingTypeLocked']
    });
  }

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
  const vacancies = await vacancyModel.findManyWithDetails({
    status: { in: PUBLIC_STATUSES },
    postingType: viewerPostingType(req.user)
  });
  res.json(vacancies.map(toPublicVacancy));
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
  // A vacancy the viewer applied for isn't theirs to run (conflictOfInterestService).
  const conflicted = await conflictOfInterest.conflictedVacancyIds(req);
  const visible = conflicted.length ? vacancies.filter((v) => !conflicted.includes(v.id)) : vacancies;
  // Each with where it is in the process and who it is waiting on
  // (vacancyProgressService) - the Stage and Waiting on columns.
  const progress = await vacancyProgress.progressFor(visible);
  res.json(visible.map((v) => ({ ...v, progress: progress.get(v.id) || null })));
}

// GET /api/vacancies/:id/progress - the step bar and Next step box on a
// vacancy's page (guardVacancy has already refused a conflicted viewer).
async function progress(req, res) {
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(404).json({ error: 'Not found' });
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Not found' });
  const map = await vacancyProgress.progressFor([vacancy]);
  res.json(map.get(vacancy.id));
}

// Shared by staff (VacancyDetail.jsx, ApplicationManagement.jsx - via
// staffApiClient, which always attaches a staff Bearer token) and
// candidates/guests (ApplyForm.jsx, the public JobDetails.jsx).
//
// Staff see every vacancy in full. Anyone else sees a vacancy only when
// listPublic would list it for them (same statuses, same posting-type
// rule), or when they are a candidate who already has an application on
// it - so a candidate can still open the advert for something they
// applied to after it closes, fills, or has its posting type transitioned.
// Everything else is a plain 404, not a 403, so vacancy ids can't be
// probed to learn which unapproved or other-audience vacancies exist.
// Previously this returned any vacancy by id to anyone, including
// PendingApproval ones and Internal ones to anonymous visitors.
async function getOne(req, res) {
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(404).json({ error: 'Not found' });
  const vacancy = await vacancyModel.findByIdWithDetails(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Not found' });
  if (req.user?.type === 'staff') {
    try {
      await conflictOfInterest.assertNotApplicant(req, vacancyId);
    } catch (err) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    return res.json(vacancy);
  }

  const listedForViewer = PUBLIC_STATUSES.includes(vacancy.status)
    && vacancy.postingType === viewerPostingType(req.user);
  if (!listedForViewer) {
    const ownApplication = req.user?.type === 'candidate'
      ? await applicationModel.findFirst({ vacancyId, candidateId: req.user.id })
      : null;
    if (!ownApplication) return res.status(404).json({ error: 'Not found' });
  }
  res.json(toPublicVacancy(vacancy));
}

async function listApplications(req, res) {
  const vacancyId = Number(req.params.id);
  if (!Number.isInteger(vacancyId)) return res.status(400).json({ error: 'Invalid vacancy id' });
  const applications = await applicationModel.findByVacancy(vacancyId);
  await accessLog.record(req, { action: 'Viewed the applicants', vacancyId, candidateIds: applications.map((a) => a.candidateId) });
  res.json(await duplicateApplicants.annotate(applications));
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
  // A vacancy with a shortlisting committee takes its interview shortlist
  // from the committee's ranking (shortlistCommitteeController.propose),
  // which HR cannot reorder.
  if (await prisma.shortlistExercise.findUnique({ where: { vacancyId } })) {
    return res.status(409).json({ error: 'This vacancy is shortlisted by its committee - propose the shortlist from the committee ranking' });
  }

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
      // Only prefix a genuine business-rule message with the application id;
      // a masked infrastructure error (e.g. database unreachable) goes out as-is.
      const { status, message } = classifyError(err, 422);
      if (status >= 500) return sendError(res, err, 422);
      return res.status(status).json({ error: `Application ${appId}: ${message}` });
    }
    rankData.push({ id: appId, rank: i + 1 });
  }

  // Lands at ShortlistProposed, not Shortlisted - same propose/approve
  // split as applicationController.shortlist. This batch only becomes the
  // vacancy's effective shortlist once a Principal HR Officer+ (who didn't
  // propose it) approves it via applicationController.approveShortlist,
  // which is also the point candidates are notified and interview
  // scheduling unlocks. Re-ranking an already-Shortlisted application (e.g.
  // reordering after a prior approval) demotes it back to
  // ShortlistProposed, requiring fresh approval - the rank/listStatus
  // changed, so the prior approval no longer covers it.
  //
  // All-or-nothing - a plain Promise.all of independent updates could leave
  // the ranking half-committed if one write failed partway through (e.g. a
  // row deleted between the guard check above and the write itself).
  const results = await prisma.$transaction(
    rankData.map(({ id, rank }) =>
      prisma.application.update({
        where: { id },
        data: {
          // listStatus: null - Primary/Reserve is decided after the
          // interviews, on the merit list (meritListService), not here.
          rank, listStatus: null, status: 'ShortlistProposed', rankVersion: { increment: 1 },
          shortlistProposedAt: new Date(), shortlistProposedById: req.user.id
        }
      })
    )
  );
  await audit.recordMany(rankData.map(({ id, rank }) => ({
    entityType: 'Application', entityId: id, action: 'Proposed for the interview shortlist', actor: audit.actorFrom(req),
    details: { rank }
  })));
  res.json(results);
}

module.exports = { create, update, close, approve, returnForRevision, reject, resubmit, transitionPostingType, readvertise, listPublic, listForAdmin, progress, getOne, listApplications, saveRanking };
