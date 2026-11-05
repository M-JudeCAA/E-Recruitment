const prisma = require('../config/db');
const conflictOfInterest = require('./conflictOfInterestService');
const { parseSource } = require('../utils/applicationSources');
const { classifyError } = require('../utils/errorResponse');
const vacancyModel = require('../models/vacancyModel');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const workflow = require('./workflowService');
const audit = require('./auditService');
const applicationDocumentModel = require('../models/applicationDocumentModel');
const evidence = require('../utils/screeningEvidence');
const {
  screenApplication, scoreApplication, evaluateEssentialCriteria, assessEligibility
} = require('./screeningService');
const {
  assertPostingTypeEligible, assertVacancyAcceptingApplications, assertBeforeDeadline
} = require('../utils/applicationEligibility');
const { isProfileComplete } = require('../utils/profileCompleteness');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { countCompleteReferees } = require('../utils/referees');
const { notifyCandidate } = require('./candidateNotificationService');
const { notify } = require('./notificationService');
const { PRIVACY_NOTICE_VERSION } = require('../config/privacyNotice');
const { employmentCheck } = require('../utils/employmentCheck');
const { snapshotDesirable, snapshotDisqualifying } = require('../utils/applicationAnswers');

// Submitting an application - the one set of checks, used three ways:
//
//   now    the candidate submits (applicationDraftController.submit)
//   queue  "Submit when verified": an Internal candidate whose UCAA
//          employment HR hasn't verified yet passes every other check now,
//          and the application is marked to go in by itself
//          (Application.submitWhenVerifiedAt). It stays a Draft they can
//          still change or cancel until then.
//   auto   HR verifies their employment (internalVerificationService.decide)
//          and every application they queued is submitted, re-checked as it
//          stands then.
//
// A queued application counts as on time: the deadline is compared to when
// it was queued, not to when HR verified (the candidate did everything in
// time; only HR's check was outstanding). Consent and where they saw the
// advert are taken when they queue it.

class SubmissionRefused extends Error {
  constructor(status, body) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}
const refuse = (status, body) => { throw new SubmissionRefused(status, body); };

/**
 * Every check before an application goes in. Throws SubmissionRefused with
 * the answer the candidate gets; returns what the submission needs.
 */
async function check(application, { candidateId, candidateType, consent, mode }) {
  if (application.status !== 'Draft') refuse(422, { error: 'Only a draft application can be submitted' });
  if (countCompleteReferees(application.referees) < 3) {
    refuse(400, { error: 'Three referees (with name, phone and email) are required before submitting' });
  }
  // FR-ATS-038: the candidate agrees to UCAA processing and retaining their
  // data, per the privacy notice, as part of submitting - never assumed. A
  // queued application carries the consent given when it was queued.
  if (mode !== 'auto' && consent !== true) {
    refuse(400, {
      error: 'Please confirm that you consent to UCAA processing your personal data, as described in the privacy notice',
      code: 'CONSENT_REQUIRED'
    });
  }

  const vacancy = await vacancyModel.findById(application.vacancyId);
  try {
    assertPostingTypeEligible(vacancy, candidateType);
    assertVacancyAcceptingApplications(vacancy);
    // Queued before the deadline counts as on time (see above).
    const at = mode !== 'queue' && application.submitWhenVerifiedAt ? new Date(application.submitWhenVerifiedAt) : new Date();
    assertBeforeDeadline(vacancy, at);
  } catch (err) {
    const { status, message, code } = classifyError(err, 422);
    refuse(status, code ? { error: message, code } : { error: message });
  }

  // Checked after the vacancy-level eligibility above, deliberately - if
  // the vacancy itself is closed/filled/past its deadline, that's the
  // relevant reason submission isn't possible. HR should never receive a
  // submission with no education/experience/contact details on file.
  const candidate = await candidateModel.findByIdWithRecords(candidateId);
  if (!isProfileComplete(candidate)) {
    refuse(422, { error: 'Please complete your profile before submitting an application' });
  }
  // An internal candidate applies only once HR has verified their UCAA
  // employment details (utils/employmentCheck.js) - or queues it to go in
  // when they are.
  const employment = employmentCheck(candidate);
  if (!employment.verified && mode !== 'queue') {
    refuse(422, { error: employment.message, code: 'EMPLOYMENT_NOT_VERIFIED', employmentCheck: employment });
  }

  // The answers re-snapshotted against the questions as they are now - what
  // this application is screened on, and stored with it.
  const answered = {
    ...application,
    desirableResponses: snapshotDesirable(application.desirableResponses, vacancy),
    disqualifyingResponses: snapshotDisqualifying(application.disqualifyingResponses, vacancy)
  };

  const documents = await applicationDocumentModel.findByApplication(application.id);
  if (!documents.some((d) => d.category === 'Academic')) {
    refuse(400, { error: 'Please upload at least one academic document (certificate or transcript) before submitting' });
  }

  // Screening starts here, at the point of application: a candidate who
  // doesn't meet the vacancy's minimums, or who answered a Disqualifying
  // question the wrong way, never reaches the applicant pool.
  const eligibility = assessEligibility(answered, candidate, vacancy);
  if (eligibility.unanswered.length > 0) {
    refuse(400, { error: 'Please answer every eligibility question before submitting', unanswered: eligibility.unanswered });
  }
  if (!eligibility.eligible) {
    refuse(422, {
      error: 'You do not meet the requirements for this vacancy, so this application cannot be submitted',
      code: 'NOT_ELIGIBLE', reasons: eligibility.reasons
    });
  }
  // What screening relied on must be backed by evidence.
  const missing = evidence.missingEvidence(evidence.evidenceRequirements(vacancy, evidence.answersOf(answered)), documents);
  if (missing.length > 0) {
    refuse(400, {
      error: `Please upload the evidence for: ${missing.map((m) => m.label).join('; ')}`,
      code: 'EVIDENCE_REQUIRED', missing
    });
  }
  return { vacancy, candidate, answered, employment };
}

/** The submission itself, once check() has passed. Returns the updated application. */
async function finish(application, { vacancy, candidate, answered }, { mode, body, actor }) {
  // Every submitted application carries its screening result from the
  // start. If HR has already opened this vacancy's review queue
  // (reviewStartedAt set), a late applicant also joins it at once.
  const screening = screenApplication(answered, candidate, vacancy);
  const score = scoreApplication(answered, candidate, vacancy);
  const essentialCriteria = evaluateEssentialCriteria(candidate, vacancy);
  const data = {
    status: vacancy.reviewStartedAt ? 'UnderReview' : 'Submitted', submittedDate: new Date(),
    desirableResponses: answered.desirableResponses, disqualifyingResponses: answered.disqualifyingResponses,
    // A queued application keeps the consent and source given when it was queued.
    ...(mode === 'auto' ? {} : {
      consentGivenAt: new Date(), consentNoticeVersion: PRIVACY_NOTICE_VERSION,
      // Where they saw the advert - optional, for the Source of Hire report.
      ...parseSource(body || {})
    }),
    screeningPassed: screening.passed, screeningReasons: JSON.stringify(screening.reasons), screenedAt: new Date(),
    fieldOfStudyMatch: screening.fieldOfStudyMatch,
    shortlistScore: score.score, shortlistScoreReasons: JSON.stringify(score.reasons),
    essentialCriteriaResults: JSON.stringify(essentialCriteria)
  };

  // Scoped to status: 'Draft' so a second, near-simultaneous submit (double
  // click, a retried request, two open tabs, HR's verification at the same
  // moment) can't also pass - see applicationModel.updateIfStatus.
  const result = await applicationModel.updateIfStatus(application.id, 'Draft', data);
  if (result.count === 0) refuse(409, { error: 'This application has already been submitted' });
  const updated = await applicationModel.findById(application.id);
  await audit.record({
    entityType: 'Application', entityId: application.id,
    action: mode === 'auto' ? 'Application submitted automatically (employment verified)' : 'Application submitted',
    actor, before: application, after: updated, fields: ['status']
  });

  await workflow.captureSnapshot({
    entityType: 'ApplicationSnapshot', entityId: application.id, candidateId: application.candidateId
  });
  // The candidate's confirmation, and a notice to whoever created the
  // vacancy - for both posting types.
  await notifyCandidate(
    application.candidateId, 'ApplicationSubmitted',
    mode === 'auto'
      ? `HR has verified your UCAA employment details, so your application for "${vacancy.title}" (${vacancy.jobRef}) has now been submitted, as you asked. We'll notify you of any updates.`
      : `Your application for "${vacancy.title}" (${vacancy.jobRef}) has been received. We'll notify you of any updates.`
  );
  // To the vacancy's creator - unless they have applied for it themselves,
  // when it goes to the Principal HR Officers instead.
  const { ids: toldIds, redirected } = await conflictOfInterest.noticeRecipients(vacancy.id, [vacancy.createdById]);
  for (const staffId of toldIds) {
    await notify(
      staffId, 'NewApplicationSubmitted', application.id,
      `${candidate.fullName} applied for "${vacancy.title}" (${vacancy.jobRef}).`
        + (redirected ? ' (Sent to you because whoever created this vacancy has applied for it.)' : '')
    );
  }

  // A UCAA staff member applying - the conflict-of-interest rule shuts them
  // out of the vacancy; this tells HR so someone else runs it.
  await conflictOfInterest.flagStaffApplicant(candidate, vacancy, application.id);
  // The hiring manager applying for their own vacancy is flagged the same way.
  await conflictOfInterest.flagHiringManagerApplicant(candidate, vacancy, application.id)
    .catch((err) => console.error(`Hiring manager conflict notice for application ${application.id} failed:`, err));

  broadcastDashboardEvent('ApplicationSubmitted', { applicationId: application.id, vacancyId: vacancy.id });
  return updated;
}

/** The candidate submits now. */
async function submitNow(application, { candidateId, candidateType, body, actor }) {
  const checked = await check(application, { candidateId, candidateType, consent: body?.consent, mode: 'now' });
  return finish(application, checked, { mode: 'now', body, actor });
}

/**
 * "Submit when verified". Returns { submitted } when the employment check is
 * already done (it goes in now), else { queued }.
 */
async function queue(application, { candidateId, candidateType, body, actor }) {
  const checked = await check(application, { candidateId, candidateType, consent: body?.consent, mode: 'queue' });
  if (checked.employment.verified) return { submitted: await finish(application, checked, { mode: 'now', body, actor }) };

  const now = new Date();
  const result = await applicationModel.updateIfStatus(application.id, 'Draft', {
    // Queued again (say after an edit): the first time still says when it was in.
    submitWhenVerifiedAt: application.submitWhenVerifiedAt || now,
    consentGivenAt: now, consentNoticeVersion: PRIVACY_NOTICE_VERSION,
    ...parseSource(body || {}),
    desirableResponses: checked.answered.desirableResponses, disqualifyingResponses: checked.answered.disqualifyingResponses
  });
  if (result.count === 0) refuse(409, { error: 'This application has already been submitted' });
  const updated = await applicationModel.findById(application.id);
  await audit.record({
    entityType: 'Application', entityId: application.id, action: 'Set to submit when employment is verified', actor,
    before: application, after: updated, fields: ['submitWhenVerifiedAt']
  });
  return { queued: updated };
}

/** Takes an application off "Submit when verified" - it is an ordinary draft again. */
async function cancelQueue(application, { actor, comment }) {
  if (application.status !== 'Draft' || !application.submitWhenVerifiedAt) return application;
  await applicationModel.updateIfStatus(application.id, 'Draft', { submitWhenVerifiedAt: null });
  const updated = await applicationModel.findById(application.id);
  await audit.record({
    entityType: 'Application', entityId: application.id, action: 'Submit when verified cancelled', actor, comment,
    before: application, after: updated, fields: ['submitWhenVerifiedAt']
  });
  return updated;
}

/**
 * HR has verified the candidate's employment: every application they queued
 * goes in. One that no longer passes (the vacancy closed, the profile no
 * longer meets it, a document was removed) stays a draft, off the queue, and
 * the candidate is told why. Never throws - the verification has happened.
 * Returns { submitted: [ids], notSubmitted: [ids] }.
 */
async function submitQueued(candidateId) {
  const out = { submitted: [], notSubmitted: [] };
  try {
    const [current, queued] = await Promise.all([
      candidateModel.findAuthState(candidateId),
      prisma.application.findMany({ where: { candidateId, status: 'Draft', submitWhenVerifiedAt: { not: null } } }).then((rows) => rows || [])
    ]);
    if (!current || current.purgedAt) return out;
    for (const application of queued) {
      const actor = { candidateId };
      try {
        const checked = await check(application, { candidateId, candidateType: current.candidateType, mode: 'auto' });
        await finish(application, checked, { mode: 'auto', actor });
        out.submitted.push(application.id);
      } catch (err) {
        if (!(err instanceof SubmissionRefused)) {
          console.error(`Automatic submission of application ${application.id} failed:`, err);
          continue; // left queued: the next verification (or the candidate) tries again
        }
        out.notSubmitted.push(application.id);
        await cancelQueue(application, { actor, comment: err.body.error }).catch(() => {});
        const vacancy = await vacancyModel.findById(application.vacancyId).catch(() => null);
        const what = vacancy ? `"${vacancy.title}" (${vacancy.jobRef})` : 'a vacancy';
        await notifyCandidate(
          candidateId, 'QueuedApplicationNotSubmitted',
          `HR has verified your UCAA employment details, but your application for ${what} could not be submitted: ${err.body.error}`
            + (err.body.code === 'EVIDENCE_REQUIRED' || err.body.code === 'NOT_ELIGIBLE' || err.status === 400
              ? ' It is still a draft - you can correct it and submit it yourself while the vacancy is open.' : '')
        ).catch((e) => console.error(`Notice for application ${application.id} failed:`, e));
      }
    }
  } catch (err) {
    console.error(`Automatic submission for candidate ${candidateId} failed:`, err);
  }
  return out;
}

module.exports = { submitNow, queue, cancelQueue, submitQueued, check, SubmissionRefused };
