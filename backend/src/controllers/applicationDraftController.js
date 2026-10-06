const conflictOfInterest = require('../services/conflictOfInterestService');
const { parseSource } = require('../utils/applicationSources');
const { sendError } = require('../utils/errorResponse');
const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const workflow = require('../services/workflowService');
const withdrawal = require('../services/applicationWithdrawalService');
const audit = require('../services/auditService');
const applicationDocumentModel = require('../models/applicationDocumentModel');
const evidence = require('../utils/screeningEvidence');
const {
  screenApplication, scoreApplication, evaluateEssentialCriteria, assessEligibility
} = require('../services/screeningService');
const { fileUrl } = require('../middleware/upload');
const { removeUploads } = require('../utils/uploadFiles');
const {
  assertPostingTypeEligible, assertVacancyAcceptingApplications, assertBeforeDeadline
} = require('../utils/applicationEligibility');
const { isProfileComplete } = require('../utils/profileCompleteness');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { countCompleteReferees } = require('../utils/referees');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { notify, notifyAllHrStaff } = require('../services/notificationService');
const { escapeHtml } = require('../utils/interviewFormat');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');

// Answers to the vacancy's questions, as [{ id, answer }], snapshotted
// against its questions as they stand now - server-side, never trusting the
// `text`/`answerType`/`minValue` a client sent alongside each answer (see the
// schema comments on Application.desirableResponses/disqualifyingResponses).
// A 'yesno' question (or one with no answerType, from before 'number'
// existed) takes a boolean, a 'number' one a finite number; unmatched or
// malformed answers are dropped. Taken at every draft save and again at
// submit, so the application is screened against the questions as they are
// when it is submitted - a question HR changed or removed after the draft
// was saved is never judged by its old wording or required answer.
const answerMatchesType = (requirement, answer) =>
  requirement.answerType === 'number' ? (typeof answer === 'number' && Number.isFinite(answer)) : typeof answer === 'boolean';

function snapshotAnswers(answers, requirements, extra) {
  const byId = new Map((requirements || []).map((r) => [r.id, r]));
  return (answers || [])
    .filter((r) => r && byId.has(r.id) && answerMatchesType(byId.get(r.id), r.answer))
    .map((r) => {
      const requirement = byId.get(r.id);
      return {
        id: r.id, text: requirement.text, ...extra(requirement), answer: r.answer,
        ...(requirement.answerType === 'number' ? { answerType: 'number', minValue: requirement.minValue } : {})
      };
    });
}

const snapshotDesirable = (answers, vacancy) => snapshotAnswers(answers, vacancy.desirableRequirements, () => ({}));
// Also freezes requiredAnswer - what screeningService reads to decide
// pass/fail.
const snapshotDisqualifying = (answers, vacancy) =>
  snapshotAnswers(answers, vacancy.disqualifyingRequirements, (r) => ({ requiredAnswer: r.requiredAnswer }));

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
  const coverLetterFile = req.files?.coverLetter?.[0];
  // A request refused below keeps nothing it uploaded.
  const refuse = async (status, body) => {
    await removeUploads(fileUrl(coverLetterFile));
    return res.status(status).json(body);
  };

  const vacancyId = Number(req.body.vacancyId);
  if (!Number.isInteger(vacancyId) || vacancyId < 1) return refuse(400, { error: 'Invalid vacancy id' });
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return refuse(404, { error: 'Vacancy not found' });

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
    await removeUploads(fileUrl(coverLetterFile));
    return sendError(res, err, 422);
  }

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
  // Answers to the vacancy's questions arrive as JSON strings (multipart
  // form fields are always strings) of [{ id, answer }] - see
  // snapshotAnswers.
  const parseList = (json) => {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  if (desirableResponses !== undefined) {
    questionsData.desirableResponses = snapshotDesirable(parseList(desirableResponses), vacancy);
  }
  if (disqualifyingResponses !== undefined) {
    questionsData.disqualifyingResponses = snapshotDisqualifying(parseList(disqualifyingResponses), vacancy);
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

  // Saves onto an existing Draft; a new cover letter replaces the old file.
  const updateDraft = async (draft) => {
    const data = { ...questionsData };
    if (coverLetterFile) data.coverLetterUrl = fileUrl(coverLetterFile);
    const updated = await applicationModel.update(draft.id, data);
    if (coverLetterFile && draft.coverLetterUrl && draft.coverLetterUrl !== data.coverLetterUrl) {
      await removeUploads(draft.coverLetterUrl);
    }
    return updated;
  };

  if (existing) {
    if (existing.status !== 'Draft') {
      const message = existing.status === 'Withdrawn'
        ? 'You have already withdrawn from this vacancy and cannot re-apply'
        : 'You have already applied to this vacancy';
      return refuse(409, { error: message });
    }
    return res.json(await updateDraft(existing));
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
      if (winner) return res.json(await updateDraft(winner));
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

  // The answers re-snapshotted against the questions as they are now - what
  // this application is screened on, and stored with it.
  const answered = {
    ...application,
    desirableResponses: snapshotDesirable(application.desirableResponses, vacancy),
    disqualifyingResponses: snapshotDisqualifying(application.disqualifyingResponses, vacancy)
  };

  const documents = await applicationDocumentModel.findByApplication(applicationId);
  if (!documents.some((d) => d.category === 'Academic')) {
    return res.status(400).json({ error: 'Please upload at least one academic document (certificate or transcript) before submitting' });
  }

  // Screening starts here, at the point of application: a candidate who
  // doesn't meet the vacancy's minimums, or who answered a Disqualifying
  // question the wrong way, never reaches the applicant pool. Their Draft
  // stays as it is, so a profile that was merely out of date can be fixed
  // and submitted again.
  const eligibility = assessEligibility(answered, candidate, vacancy);
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
  const missing = evidence.missingEvidence(evidence.evidenceRequirements(vacancy, evidence.answersOf(answered)), documents);
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
  const screening = screenApplication(answered, candidate, vacancy);
  const score = scoreApplication(answered, candidate, vacancy);
  const essentialCriteria = evaluateEssentialCriteria(candidate, vacancy);
  const data = {
    status: vacancy.reviewStartedAt ? 'UnderReview' : 'Submitted', submittedDate: new Date(),
    desirableResponses: answered.desirableResponses, disqualifyingResponses: answered.disqualifyingResponses,
    consentGivenAt: new Date(), consentNoticeVersion: PRIVACY_NOTICE_VERSION,
    // Where they saw the advert - optional, for the Source of Hire report.
    ...parseSource(req.body),
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

// Where the application had got to, for HR's notice.
const WITHDRAWN_AT = {
  Submitted: 'after applying', UnderReview: 'while under review', ShortlistProposed: 'while proposed for the interview shortlist',
  Shortlisted: 'after being shortlisted for interview', InterviewScheduled: 'with an interview booked', Interviewed: 'after being interviewed'
};

// All HR staff are told - except anyone who applied for this vacancy, who
// has no business hearing about the other applicants. Never fails the
// withdrawal, which has already happened.
async function notifyHrOfWithdrawal(application, reason, result) {
  try {
    const [vacancy, candidate] = await Promise.all([
      vacancyModel.findById(application.vacancyId),
      candidateModel.findById(application.candidateId)
    ]);
    const parts = [
      `${escapeHtml(candidate?.fullName || 'A candidate')} withdrew their application for "${escapeHtml(vacancy?.title || 'a vacancy')}"`
        + ` (${escapeHtml(vacancy?.jobRef || '')}) ${WITHDRAWN_AT[application.status] || ''}.`,
      reason ? `Reason given: ${escapeHtml(reason)}.` : null,
      result.cancelledInterviewIds.length
        ? `${result.cancelledInterviewIds.length === 1 ? 'Their interview has' : `${result.cancelledInterviewIds.length} interviews have`} been cancelled and the panel told.`
        : null,
      result.wasPrimary
        ? (result.promoted
          ? `They were Primary on the merit list: the next reserve (application #${result.promoted.id}) has moved up - recommend an offer when ready.`
          : 'They were Primary on the merit list, and no reserve was available to move up.')
        : null
    ];
    const exceptIds = await conflictOfInterest.staffIdsAppliedFor(application.vacancyId);
    await notifyAllHrStaff('ApplicationWithdrawn', application.id, parts.filter(Boolean).join(' '), { exceptIds });
  } catch (err) {
    console.error(`Withdrawal notice for application ${application.id} failed:`, err);
  }
}

// Any stage before an offer (applicationWithdrawalService: upcoming
// interviews are cancelled, the merit list place is given up and a Primary's
// post goes to the next reserve). Once offered, they decline the offer.
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
  if (application.status === 'Draft') {
    // The draft's documents go with the row (onDelete: Cascade); their files too.
    const documents = await applicationDocumentModel.findByApplication(applicationId);
    await applicationModel.remove(applicationId);
    await removeUploads(application.cvUrl, application.coverLetterUrl, documents.map((d) => d.fileUrl));
    return res.json({ id: applicationId, vacancyId: application.vacancyId, cancelled: true });
  }

  // Optional - the candidate's prerogative, useful for HR reporting when given.
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
  let result;
  try {
    result = await withdrawal.withdraw(application, reason);
  } catch (err) {
    return sendError(res, err);
  }
  const updated = await applicationModel.findById(applicationId);
  await audit.record({
    entityType: 'Application', entityId: applicationId, action: 'Application withdrawn by the candidate', actor: audit.actorFrom(req),
    before: application, after: updated, fields: ['status'], comment: reason || null,
    details: {
      ...(result.cancelledInterviewIds.length ? { cancelledInterviewIds: result.cancelledInterviewIds } : {}),
      ...(result.wasPrimary ? { leftMeritListAsPrimary: true, promotedApplicationId: result.promoted?.id || null } : {})
    }
  });
  await notifyHrOfWithdrawal(application, reason, result);
  broadcastDashboardEvent('ApplicationUpdated', { applicationId, vacancyId: application.vacancyId });
  // Never another applicant's row (result.promoted) - the caller is the candidate.
  res.json({ id: updated.id, vacancyId: updated.vacancyId, status: updated.status, withdrawalReason: updated.withdrawalReason });
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
  // A refused upload isn't kept.
  const refuse = async (status, body) => {
    await removeUploads(fileUrl(req.file));
    return res.status(status).json(body);
  };
  const application = await loadOwnDraft(req, res);
  if (!application) { await removeUploads(fileUrl(req.file)); return; }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const category = req.body.category;
  if (!DOCUMENT_CATEGORIES.includes(category)) {
    return refuse(400, { error: `Document category must be one of: ${DOCUMENT_CATEGORIES.join(', ')}` });
  }
  let evidenceKey = null;
  let label = (req.body.label || '').trim().slice(0, 150) || null;
  if (category === 'Evidence') {
    // Filed under one of this vacancy's evidence requirements, labelled
    // with it so HR sees what it is meant to prove.
    evidenceKey = String(req.body.evidenceKey || '');
    const vacancy = await vacancyModel.findById(application.vacancyId);
    const requirement = evidence.KEY_RE.test(evidenceKey) ? evidence.requirementFor(vacancy, evidenceKey) : null;
    if (!requirement) return refuse(400, { error: 'Say which requirement this document is evidence for' });
    const mine = await applicationDocumentModel.findByApplication(application.id);
    if (mine.filter((d) => d.evidenceKey === evidenceKey).length >= MAX_DOCUMENTS_PER_EVIDENCE) {
      return refuse(422, { error: `You can attach at most ${MAX_DOCUMENTS_PER_EVIDENCE} documents for one requirement` });
    }
    label = requirement.label.slice(0, evidence.MAX_LABEL);
  } else if (await applicationDocumentModel.countByApplication(application.id, category) >= MAX_DOCUMENTS_PER_CATEGORY) {
    return refuse(422, { error: `You can attach at most ${MAX_DOCUMENTS_PER_CATEGORY} documents of this kind` });
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
  await removeUploads(document.fileUrl);
  res.json({ id: documentId, removed: true });
}

module.exports = { saveDraft, submit, withdraw, eligibility, addDocument, removeDocument };
