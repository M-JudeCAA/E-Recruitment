const conflictOfInterest = require('../services/conflictOfInterestService');
const { sendError } = require('../utils/errorResponse');
const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const workflow = require('../services/workflowService');
const audit = require('../services/auditService');
const applicationDocumentModel = require('../models/applicationDocumentModel');
const evidence = require('../utils/screeningEvidence');
const {
  screenApplication, scoreApplication, evaluateEssentialCriteria, assessEligibility
} = require('../services/screeningService');
const { fileUrl } = require('../middleware/upload');
const {
  assertPostingTypeEligible, assertVacancyAcceptingApplications, assertBeforeDeadline
} = require('../utils/applicationEligibility');
const { isProfileComplete } = require('../utils/profileCompleteness');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { countCompleteReferees } = require('../utils/referees');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { notify } = require('../services/notificationService');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');

// REPLACES the old single-step submit() entirely - having two parallel
// "create an application" code paths (one direct-to-Submitted, one
// draft-based) is exactly the kind of sibling-endpoint divergence this
// project has already been bitten by more than once. A candidate who
// wants to apply in one sitting just calls this, then immediately calls
// submit() below - two requests, but one shared set of eligibility
// checks, never two copies of the same logic drifting apart.
//
// Behaviour:
//  - No existing application for this (vacancy, candidate) pair -> create a new Draft.
//  - An existing Draft -> update it in place (this is how "keep editing
//    your draft" works - same endpoint, not a separate PATCH).
//  - An existing application in any OTHER status -> rejected. This is
//    what makes withdrawal a one-way door: a Withdrawn row still exists
//    for that (vacancyId, candidateId) pair, so it is found here and
//    rejected exactly like an already-Submitted one would be - no
//    special-casing needed, it falls out of the existing unique
//    constraint and this same branch.
async function saveDraft(req, res) {
  const vacancyId = Number(req.body.vacancyId);
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  try {
    assertPostingTypeEligible(vacancy, req.user.candidateType);
    assertVacancyAcceptingApplications(vacancy);
    // CHANGED - a closed (deadline-passed) vacancy's draft can no longer be
    // created OR continued/edited here, applying to both branches below.
    // The Draft row itself is never deleted or hidden by this - it still
    // shows up on My Applications (with its Started date), just without a
    // working "Continue draft" link once its vacancy has closed.
    assertBeforeDeadline(vacancy);
  } catch (err) {
    return sendError(res, err, 422);
  }

  const coverLetterFile = req.files?.coverLetter?.[0];

  // The wizard's Questions step - application-level (unlike the
  // candidate-level profile fields on Candidate, these vary per
  // application) - sent alongside the multipart draft-save request so a
  // single "Save as draft" persists everything the candidate has entered
  // so far, matching how coverLetter already works.
  const { desiredSalary, openToRelocate, earliestStartDate, whyThisRole, desirableResponses, disqualifyingResponses, referees } = req.body;
  const questionsData = {};
  if (desiredSalary !== undefined) questionsData.desiredSalary = desiredSalary || null;
  if (openToRelocate !== undefined) questionsData.openToRelocate = openToRelocate || null;
  if (earliestStartDate !== undefined) questionsData.earliestStartDate = earliestStartDate ? new Date(earliestStartDate) : null;
  if (whyThisRole !== undefined) questionsData.whyThisRole = whyThisRole || null;
  // Answers to the vacancy's Desirable Requirements questions - arrives as
  // a JSON string (multipart form fields are always strings) of [{ id,
  // answer }]. Re-derived and snapshotted against the vacancy's current
  // desirableRequirements here, server-side, rather than trusting whatever
  // `text`/`answerType`/`minValue` the client sent alongside each answer -
  // matches the historical-snapshot principle (see the schema comment on
  // Application.desirableResponses) while still not letting the client put
  // words in the vacancy's mouth. A 'yesno' requirement (or one with no
  // answerType, from before 'number' existed) expects a boolean answer; a
  // 'number' one expects a finite number. Unmatched/malformed rows are
  // dropped rather than rejected, same tolerance as the rest of this
  // form-save endpoint.
  const answerMatchesType = (requirement, answer) =>
    requirement.answerType === 'number' ? (typeof answer === 'number' && Number.isFinite(answer)) : typeof answer === 'boolean';

  if (desirableResponses !== undefined) {
    let parsed = [];
    try {
      parsed = JSON.parse(desirableResponses);
    } catch {
      parsed = [];
    }
    const requirementsById = new Map((vacancy.desirableRequirements || []).map((r) => [r.id, r]));
    questionsData.desirableResponses = (Array.isArray(parsed) ? parsed : [])
      .filter((r) => r && requirementsById.has(r.id) && answerMatchesType(requirementsById.get(r.id), r.answer))
      .map((r) => {
        const requirement = requirementsById.get(r.id);
        return {
          id: r.id, text: requirement.text, answer: r.answer,
          ...(requirement.answerType === 'number' ? { answerType: 'number', minValue: requirement.minValue } : {})
        };
      });
  }
  // Same snapshot pattern as desirableResponses above, but also freezing
  // requiredAnswer (not just text) - see the schema comment on
  // Application.disqualifyingResponses for why: this is what
  // screeningService actually reads to decide pass/fail, so a later edit
  // to the vacancy's required answer (or minValue) must never retroactively
  // change an already-screened result.
  if (disqualifyingResponses !== undefined) {
    let parsed = [];
    try {
      parsed = JSON.parse(disqualifyingResponses);
    } catch {
      parsed = [];
    }
    const requirementsById = new Map((vacancy.disqualifyingRequirements || []).map((r) => [r.id, r]));
    questionsData.disqualifyingResponses = (Array.isArray(parsed) ? parsed : [])
      .filter((r) => r && requirementsById.has(r.id) && answerMatchesType(requirementsById.get(r.id), r.answer))
      .map((r) => {
        const requirement = requirementsById.get(r.id);
        return {
          id: r.id, text: requirement.text, requiredAnswer: requirement.requiredAnswer, answer: r.answer,
          ...(requirement.answerType === 'number' ? { answerType: 'number', minValue: requirement.minValue } : {})
        };
      });
  }

  // Three referees the candidate names for THIS application (see the
  // wizard's Referees step) - arrives the same way as
  // desirableResponses/disqualifyingResponses above (a JSON string, since
  // multipart form fields are always strings). Trimmed and capped at 3;
  // an entry with nothing at all in it is dropped rather than stored as an
  // empty placeholder. submit() below is what actually enforces all three
  // being complete - this is just parse-and-store.
  if (referees !== undefined) {
    let parsed = [];
    try {
      parsed = JSON.parse(referees);
    } catch {
      parsed = [];
    }
    questionsData.referees = (Array.isArray(parsed) ? parsed : [])
      .slice(0, 3)
      .map((r) => ({
        name: (r?.name || '').trim(),
        relationship: (r?.relationship || '').trim(),
        organization: (r?.organization || '').trim(),
        phone: (r?.phone || '').trim(),
        email: (r?.email || '').trim()
      }))
      .filter((r) => r.name || r.relationship || r.organization || r.phone || r.email);
  }

  const existing = await applicationModel.findFirst({ vacancyId, candidateId: req.user.id });

  if (existing) {
    if (existing.status !== 'Draft') {
      const message = existing.status === 'Withdrawn'
        ? 'You have already withdrawn from this vacancy and cannot re-apply'
        : 'You have already applied to this vacancy';
      return res.status(409).json({ error: message });
    }
    const data = { ...questionsData };
    if (coverLetterFile) data.coverLetterUrl = fileUrl(coverLetterFile);
    const updated = await applicationModel.update(existing.id, data);
    return res.json(updated);
  }

  try {
    const application = await applicationModel.create({
      vacancyId,
      candidateId: req.user.id,
      coverLetterUrl: fileUrl(coverLetterFile),
      status: 'Draft',
      ...questionsData
    });
    res.status(201).json(application);
  } catch (err) {
    // Two concurrent saveDraft calls for the same (vacancyId, candidateId)
    // pair - e.g. the apply wizard auto-saving on more than one "Continue"
    // click in quick succession - can both reach the findFirst check above
    // before either has actually inserted a row, so both attempt create()
    // and the loser hits this unique constraint. Falling back to updating
    // the winner's row keeps this endpoint safe to call concurrently,
    // rather than surfacing a raw database error to the candidate.
    if (err.code === 'P2002') {
      const winner = await applicationModel.findFirst({ vacancyId, candidateId: req.user.id });
      if (winner) {
        const data = { ...questionsData };
        if (coverLetterFile) data.coverLetterUrl = fileUrl(coverLetterFile);
        const updated = await applicationModel.update(winner.id, data);
        return res.json(updated);
      }
    }
    throw err;
  }
}

// The real gate - all three eligibility checks apply here, plus the one
// check that's specific to submission itself: a CV must actually be on
// file. This is the only place ApplicationSnapshot gets captured and the
// supervisor gets notified, matching the existing principle that those
// two things represent "what was true when the candidate committed to
// applying," not a work in progress.
async function submit(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
  const application = await applicationModel.findById(applicationId);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your application' });
  }
  if (application.status !== 'Draft') {
    return res.status(422).json({ error: 'Only a draft application can be submitted' });
  }
  if (countCompleteReferees(application.referees) < 3) {
    return res.status(400).json({ error: 'Three referees (with name, phone and email) are required before submitting' });
  }
  // FR-ATS-038: the candidate agrees to UCAA processing and retaining their
  // data, per the privacy notice, as part of submitting - never assumed.
  if (req.body?.consent !== true) {
    return res.status(400).json({
      error: 'Please confirm that you consent to UCAA processing your personal data, as described in the privacy notice',
      code: 'CONSENT_REQUIRED'
    });
  }

  const vacancy = await vacancyModel.findById(application.vacancyId);
  try {
    assertPostingTypeEligible(vacancy, req.user.candidateType);
    assertVacancyAcceptingApplications(vacancy);
    assertBeforeDeadline(vacancy); // the one check draft-save deliberately skipped
  } catch (err) {
    return sendError(res, err, 422);
  }

  // Checked after the vacancy-level eligibility above, deliberately - if
  // the vacancy itself is closed/filled/past its deadline, that's the
  // relevant reason submission isn't possible, and it would be a confusing
  // (and wrong) message to tell the candidate to go complete their profile
  // when doing so wouldn't help at all. The "complete your profile" prompt
  // elsewhere in the app (modal on the dashboard/apply wizard) is closable
  // and reappears rather than blocking anything - this is the one place
  // that's actually enforced, since HR should never receive a submission
  // with no education/experience/contact details on file just because the
  // candidate dismissed a reminder.
  const candidate = await candidateModel.findByIdWithRecords(req.user.id);
  if (!isProfileComplete(candidate)) {
    return res.status(422).json({ error: 'Please complete your profile before submitting an application' });
  }

  const documents = await applicationDocumentModel.findByApplication(applicationId);
  if (!documents.some((d) => d.category === 'Academic')) {
    return res.status(400).json({ error: 'Please upload at least one academic document (certificate or transcript) before submitting' });
  }

  // Screening starts here, at the point of application: a candidate who
  // doesn't meet the vacancy's minimums, or who answered a Disqualifying
  // question the wrong way, never reaches the applicant pool. Their Draft
  // stays as it is, so a profile that was merely out of date can be fixed
  // and submitted again.
  const eligibility = assessEligibility(application, candidate, vacancy);
  if (eligibility.unanswered.length > 0) {
    return res.status(400).json({
      error: 'Please answer every eligibility question before submitting', unanswered: eligibility.unanswered
    });
  }
  if (!eligibility.eligible) {
    return res.status(422).json({
      error: 'You do not meet the requirements for this vacancy, so this application cannot be submitted',
      code: 'NOT_ELIGIBLE', reasons: eligibility.reasons
    });
  }
  // What screening relied on must be backed by evidence: the National ID
  // for an age limit, a certificate or licence for a question answered Yes.
  const missing = evidence.missingEvidence(evidence.evidenceRequirements(vacancy, evidence.answersOf(application)), documents);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Please upload the evidence for: ${missing.map((m) => m.label).join('; ')}`,
      code: 'EVIDENCE_REQUIRED', missing
    });
  }

  // Every submitted application carries its screening result from the
  // start. If HR has already opened this vacancy's review queue
  // (reviewStartedAt set), a late applicant also joins that queue
  // immediately rather than sitting at Submitted until someone re-runs
  // Begin Review.
  const screening = screenApplication(application, candidate, vacancy);
  const score = scoreApplication(application, candidate, vacancy);
  const essentialCriteria = evaluateEssentialCriteria(candidate, vacancy);
  const data = {
    status: vacancy.reviewStartedAt ? 'UnderReview' : 'Submitted', submittedDate: new Date(),
    consentGivenAt: new Date(), consentNoticeVersion: PRIVACY_NOTICE_VERSION,
    screeningPassed: screening.passed, screeningReasons: JSON.stringify(screening.reasons), screenedAt: new Date(),
    fieldOfStudyMatch: screening.fieldOfStudyMatch,
    shortlistScore: score.score, shortlistScoreReasons: JSON.stringify(score.reasons),
    essentialCriteriaResults: JSON.stringify(essentialCriteria)
  };

  // Scoped to status: 'Draft' so a second, near-simultaneous submit call
  // for the same application (double click reaching the API, a retried
  // request, two open tabs) can't also pass - see applicationModel.js's
  // comment on updateIfStatus for why this needs to be atomic rather than
  // the earlier "read status, then write" check above.
  const result = await applicationModel.updateIfStatus(applicationId, 'Draft', data);
  if (result.count === 0) {
    return res.status(409).json({ error: 'This application has already been submitted' });
  }
  const updated = await applicationModel.findById(applicationId);
  await audit.record({
    entityType: 'Application', entityId: applicationId, action: 'Application submitted', actor: audit.actorFrom(req),
    before: application, after: updated, fields: ['status']
  });

  await workflow.captureSnapshot({
    entityType: 'ApplicationSnapshot', entityId: applicationId, candidateId: req.user.id
  });
  // Internal-only, unaffected by the two notifications below - notifies
  // the candidate's declared supervisor, a different audience than either.
  await workflow.notifySupervisor(applicationId);

  // Closes two gaps found in the same audit: (1) SubmitStep.jsx has always
  // promised "a confirmation has been sent to your email" - nothing ever
  // sent one until now; (2) an External candidate's submission previously
  // notified literally no one on the HR side (notifySupervisor above
  // no-ops for anyone who isn't Internal) - this fires for both posting
  // types, to whoever created the vacancy, regardless.
  await notifyCandidate(
    req.user.id, 'ApplicationSubmitted',
    `Your application for "${vacancy.title}" (${vacancy.jobRef}) has been received. We'll notify you of any updates.`
  );
  await notify(
    vacancy.createdById, 'NewApplicationSubmitted', applicationId,
    `${candidate.fullName} applied for "${vacancy.title}" (${vacancy.jobRef}).`
  );

  // A UCAA staff member applying - the conflict-of-interest rule shuts them
  // out of the vacancy; this tells HR so someone else runs it.
  await conflictOfInterest.flagStaffApplicant(candidate, vacancy, applicationId);

  broadcastDashboardEvent('ApplicationSubmitted', { applicationId, vacancyId: vacancy.id });
  res.json(updated);
}

// Limited deliberately to Draft/Submitted - withdrawing from Shortlisted
// or later has real cascade questions (does it free a Reserve slot? does
// it need the same care as the offer-decline cascade?) that belong with
// the shortlisting workflow, not here.
//
// Cancelling a Draft is NOT the same event as withdrawing a Submitted
// application, and the two are deliberately handled differently:
//   - A Draft was never seen by HR and never represented a real
//     commitment, so cancelling it deletes the row outright, freeing the
//     (vacancyId, candidateId) slot so the candidate can start a
//     genuinely fresh application to the same vacancy.
//   - A Submitted application is a real, HR-visible commitment the
//     candidate is backing out of - that stays a one-way door (row kept
//     as Withdrawn, re-applying to the same vacancy is refused), per
//     Decision #8 in the candidate application workflow spec.
async function withdraw(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
  const application = await applicationModel.findById(applicationId);
  if (!application) return res.status(404).json({ error: 'Application not found' });
  if (application.candidateId !== req.user.id) {
    return res.status(403).json({ error: 'This is not your application' });
  }
  if (!['Draft', 'Submitted'].includes(application.status)) {
    return res.status(422).json({ error: 'This application can no longer be withdrawn' });
  }

  if (application.status === 'Draft') {
    await applicationModel.remove(applicationId);
    return res.json({ id: applicationId, vacancyId: application.vacancyId, cancelled: true });
  }

  const { reason } = req.body; // optional - candidate's prerogative, useful for HR reporting when given
  const updated = await applicationModel.update(applicationId, {
    status: 'Withdrawn', withdrawalReason: reason || null
  });
  await audit.record({
    entityType: 'Application', entityId: applicationId, action: 'Application withdrawn by the candidate', actor: audit.actorFrom(req),
    before: application, after: updated, fields: ['status'], comment: reason || null
  });
  res.json(updated);
}

// The apply wizard's early screening check: whether this candidate, as
// their profile stands now (and with the eligibility answers on their
// draft, if they have one), may apply to this vacancy. Same rules submit()
// enforces - see screeningService.assessEligibility. Only the reasons
// derived from the candidate's own data are returned, never other
// applicants' or HR's.
async function eligibility(req, res) {
  const vacancyId = Number(req.params.vacancyId);
  if (!Number.isInteger(vacancyId)) return res.status(400).json({ error: 'Invalid vacancy id' });
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });

  const [candidate, application] = await Promise.all([
    candidateModel.findByIdWithRecords(req.user.id),
    applicationModel.findFirst({ vacancyId, candidateId: req.user.id })
  ]);
  const result = assessEligibility(application, candidate, vacancy);
  const documents = application ? await applicationDocumentModel.findByApplication(application.id) : [];
  const requirements = evidence.evidenceRequirements(vacancy, evidence.answersOf(application));
  const missing = new Set(evidence.missingEvidence(requirements, documents).map((r) => r.key));
  res.json({
    ...result,
    academicDocuments: documents.filter((d) => d.category === 'Academic').length,
    evidence: requirements.map((r) => ({ ...r, provided: !missing.has(r.key) }))
  });
}

const DOCUMENT_CATEGORIES = ['Academic', 'Other', 'Evidence'];
const MAX_DOCUMENTS_PER_CATEGORY = 10;
const MAX_DOCUMENTS_PER_EVIDENCE = 5;

// Loads an application for a document change: must be the caller's own and
// still a Draft - once submitted, what HR received is fixed.
async function loadOwnDraft(req, res) {
  const applicationId = Number(req.params.id);
  if (!Number.isInteger(applicationId)) { res.status(400).json({ error: 'Invalid application id' }); return null; }
  const application = await applicationModel.findById(applicationId);
  if (!application) { res.status(404).json({ error: 'Application not found' }); return null; }
  if (application.candidateId !== req.user.id) { res.status(403).json({ error: 'This is not your application' }); return null; }
  if (application.status !== 'Draft') {
    res.status(422).json({ error: 'Documents can only be changed before the application is submitted' });
    return null;
  }
  return application;
}

// One academic or other supporting document, uploaded as soon as the
// candidate picks it (not held until the next draft save).
async function addDocument(req, res) {
  const application = await loadOwnDraft(req, res);
  if (!application) return;
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = req.body.category;
  if (!DOCUMENT_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Document category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}` });
  }
  let evidenceKey = null;
  let label = (req.body.label || '').trim().slice(0, 150) || null;
  if (category === 'Evidence') {
    // Filed under one of this vacancy's evidence requirements, labelled
    // with it so HR sees what it is meant to prove.
    evidenceKey = String(req.body.evidenceKey || '');
    const vacancy = await vacancyModel.findById(application.vacancyId);
    const requirement = evidence.KEY_RE.test(evidenceKey) ? evidence.requirementFor(vacancy, evidenceKey) : null;
    if (!requirement) return res.status(400).json({ error: 'Say which requirement this document is evidence for' });
    const mine = await applicationDocumentModel.findByApplication(application.id);
    if (mine.filter((d) => d.evidenceKey === evidenceKey).length >= MAX_DOCUMENTS_PER_EVIDENCE) {
      return res.status(422).json({ error: `You can attach at most ${MAX_DOCUMENTS_PER_EVIDENCE} documents for one requirement` });
    }
    label = requirement.label.slice(0, evidence.MAX_LABEL);
  } else if (await applicationDocumentModel.countByApplication(application.id, category) >= MAX_DOCUMENTS_PER_CATEGORY) {
    return res.status(422).json({ error: `You can attach at most ${MAX_DOCUMENTS_PER_CATEGORY} documents of this kind` });
  }
  const document = await applicationDocumentModel.create({
    applicationId: application.id, category, label, evidenceKey,
    fileUrl: fileUrl(req.file), originalName: req.file.originalname.slice(0, 190)
  });
  res.status(201).json(document);
}

async function removeDocument(req, res) {
  const application = await loadOwnDraft(req, res);
  if (!application) return;
  const documentId = Number(req.params.documentId);
  const document = Number.isInteger(documentId) ? await applicationDocumentModel.findById(documentId) : null;
  if (!document || document.applicationId !== application.id) return res.status(404).json({ error: 'Document not found' });
  await applicationDocumentModel.remove(documentId);
  res.json({ id: documentId, removed: true });
}

module.exports = { saveDraft, submit, withdraw, eligibility, addDocument, removeDocument };
