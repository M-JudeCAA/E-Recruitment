const prisma = require('../config/db');

// Where a vacancy is in the process, worked out from its records - never
// stored, so it can't drift from them. Drives the staff workspace: the Stage
// and "Waiting on" columns of the vacancy list, the step bar and "Next step"
// box on a vacancy's page, and the Inbox (inboxService), which lists the
// next steps that are the viewer's to take.
//
// next: { kind, text, short, who, role, tab, excludeStaffIds, since }
//   role - the tier responsible (null when nobody on staff acts: the
//          candidate, the committee, the panel), used by the Inbox
//   tab  - the vacancy page tab where the step is taken
//   excludeStaffIds - who may not take it (self-approval rules)

const STEPS = [
  { key: 'approval', label: 'Approval', tab: 'overview' },
  { key: 'advertised', label: 'Advertised', tab: 'applicants' },
  { key: 'committee', label: 'Committee', tab: 'committee' },
  { key: 'exco', label: 'EXCO', tab: 'interviews' },
  { key: 'interviews', label: 'Interviews', tab: 'interviews' },
  { key: 'merit', label: 'Merit list', tab: 'merit' },
  { key: 'offers', label: 'Offers', tab: 'merit' },
  { key: 'hired', label: 'Hired', tab: 'merit' }
];
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i]));

const WHO = {
  HR_Officer: 'HR Officer',
  Senior_HR_Officer: 'Senior HR Officer',
  Principal_HR_Officer: 'Principal HR Officer',
  Manager: 'Manager or Director',
  Director: 'Director HR & Admin'
};

function formatDay(date) {
  try {
    return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Africa/Kampala' });
  } catch {
    return new Date(date).toDateString();
  }
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const names = (apps) => {
  const list = apps.map((a) => a.candidate?.fullName || 'A candidate');
  return list.length <= 2 ? list.join(' and ') : `${list.slice(0, 2).join(', ')} and ${plural(list.length - 2, 'other')}`;
};

function step(kind, role, text, short, tab, extra = {}) {
  return { kind, role, who: role ? WHO[role] : extra.who, text, short, tab, excludeStaffIds: [], ...extra };
}

/** Pure: the progress of one vacancy from its facts. Exported for tests. */
function computeProgress(vacancy, facts = {}, now = new Date()) {
  const apps = facts.applications || [];
  const exercise = facts.exercise || null;
  const resultsDue = facts.resultsDue || 0;
  const posts = vacancy.positionsRequired || 1;
  const count = (...statuses) => apps.filter((a) => statuses.includes(a.status)).length;
  const offers = apps.filter((a) => a.offer).map((a) => ({ ...a.offer, app: a }));
  const accepted = offers.filter((o) => o.status === 'Accepted').length;
  const hired = apps.filter((a) => a.hire).length;
  const deadlinePassed = vacancy.deadline && new Date(vacancy.deadline) < now;

  let stepIndex = null;
  let stage;
  let next = null;

  if (vacancy.status === 'Rejected') {
    stage = { label: 'Rejected', tone: 'bad' };
  } else if (vacancy.status === 'Closed') {
    stage = { label: 'Closed', tone: 'neutral' };
  } else if (vacancy.status === 'Returned') {
    stepIndex = 0;
    stage = { label: 'Returned for changes', tone: 'warn' };
    next = step('resubmitVacancy', 'HR_Officer',
      `Returned by the approver${vacancy.returnReason ? `: “${vacancy.returnReason}”` : ''}. Edit it and resubmit it for approval.`,
      'resubmit', 'overview');
  } else if (vacancy.status === 'PendingApproval') {
    stepIndex = 0;
    stage = { label: 'Pending approval', tone: 'warn' };
    next = step('approveVacancy', 'Manager',
      'A Manager or Director approves it before it is advertised.', 'approval', 'overview',
      { excludeStaffIds: [vacancy.createdById].filter(Boolean), since: vacancy.approvalRequestedAt || vacancy.createdAt });
  } else if (vacancy.status === 'Filled') {
    stepIndex = 7;
    stage = { label: 'Filled', tone: 'ok' };
    const toHire = apps.filter((a) => a.offer?.status === 'Accepted' && !a.hire);
    if (toHire.length) {
      next = step('markHired', 'Principal_HR_Officer',
        `${names(toHire)} accepted. Mark ${toHire.length === 1 ? 'them' : 'them'} as hired with the signed appointing instrument.`,
        'mark as hired', 'merit');
    }
  } else if (!deadlinePassed) {
    stepIndex = 1;
    stage = { label: 'Advertised', tone: 'ok' };
    if (exercise?.nominationStatus === 'Submitted') {
      next = step('approveCommittee', 'Director',
        'The shortlisting committee is waiting for the DHRA’s approval.', 'committee approval', 'committee',
        { excludeStaffIds: [exercise.nominationSubmittedById].filter(Boolean), since: exercise.nominationSubmittedAt });
    } else if (exercise?.nominationStatus === 'Returned') {
      next = step('reviseCommittee', 'Senior_HR_Officer',
        'The DHRA returned the shortlisting committee. Change the members and submit it again.', 'revise committee', 'committee');
    } else {
      next = step('advertising', null,
        `Applications close on ${vacancy.deadline ? formatDay(vacancy.deadline) : 'the closing date'}. ${plural(apps.length, 'application')} so far.`,
        vacancy.deadline ? `closes ${formatDay(vacancy.deadline)}` : 'advertised', 'applicants', { who: 'Applicants' });
    }
  } else {
    // Closed to applications: the furthest step any application has reached.
    const recommended = offers.filter((o) => o.status === 'Recommended');
    const returned = offers.filter((o) => o.status === 'Returned');
    const withCandidate = offers.filter((o) => ['Approved', 'Extended'].includes(o.status));
    const primaryNoOffer = apps.filter((a) => a.meritStatus === 'Approved' && a.meritListStatus === 'Primary' && !a.offer && a.status === 'Interviewed');
    const meritApproved = apps.some((a) => a.meritStatus === 'Approved');
    const meritProposed = apps.filter((a) => a.meritStatus === 'Proposed');
    const scheduled = count('InterviewScheduled');
    const interviewed = count('Interviewed', 'Offered');
    const shortlisted = apps.filter((a) => a.status === 'Shortlisted');
    const awaitingExco = shortlisted.filter((a) => !a.excoApprovalId && !a.hasRounds);
    const proposed = apps.filter((a) => a.status === 'ShortlistProposed');

    if (offers.length || primaryNoOffer.length || meritApproved) {
      stepIndex = 6;
      stage = { label: `Offers · ${accepted} of ${posts} accepted`, tone: 'brand' };
      if (recommended.length) {
        next = step('approveOffer', 'Manager',
          `${names(recommended.map((o) => o.app))}’s offer${recommended.length > 1 ? 's are' : ' is'} waiting for approval.`, 'offer approval', 'merit',
          { excludeStaffIds: recommended.map((o) => o.recommendedById).filter(Boolean), since: recommended[0].recommendedDate });
      } else if (returned.length) {
        next = step('reviseOffer', 'Principal_HR_Officer',
          `${names(returned.map((o) => o.app))}’s offer was returned by the approver. Revise it.`, 'revise offer', 'merit');
      } else if (primaryNoOffer.length) {
        next = step('draftOffer', 'Principal_HR_Officer',
          `${names(primaryNoOffer)} ${primaryNoOffer.length === 1 ? 'is' : 'are'} Primary on the merit list with no offer yet. Draft the offer.`, 'draft offer', 'merit');
      } else if (apps.some((a) => a.offer?.status === 'Accepted' && !a.hire)) {
        const toHire = apps.filter((a) => a.offer?.status === 'Accepted' && !a.hire);
        next = step('markHired', 'Principal_HR_Officer',
          `${names(toHire)} accepted. Mark them as hired with the signed appointing instrument.`, 'mark as hired', 'merit');
      } else if (withCandidate.length) {
        const first = withCandidate[0];
        next = step('withCandidate', null,
          `${names(withCandidate.map((o) => o.app))} ${withCandidate.length === 1 ? 'has' : 'have'} the offer${first.responseDeadline ? ` and must answer by ${formatDay(first.responseDeadline)}` : ''}.`,
          'candidate’s answer', 'merit', { who: 'Candidate' });
      }
    } else if (meritProposed.length) {
      stepIndex = 5;
      stage = { label: 'Merit list for approval', tone: 'warn' };
      next = step('approveMerit', 'Principal_HR_Officer',
        'The merit list has been proposed. Approve it, or change it and propose again.', 'approve merit list', 'merit',
        { excludeStaffIds: [...new Set(meritProposed.map((a) => a.meritProposedById).filter(Boolean))], since: meritProposed[0].meritProposedAt });
    } else if (interviewed || scheduled || resultsDue) {
      stepIndex = 4;
      stage = { label: 'Interviews', tone: 'info' };
      if (resultsDue) {
        next = step('recordResults', 'HR_Officer',
          `${plural(resultsDue, 'interview')} held with no results recorded. Record them from the panel’s signed score sheet.`, 'record results', 'interviews');
      } else if (awaitingExco.length) {
        next = step('attachExco', 'Senior_HR_Officer',
          `${plural(awaitingExco.length, 'candidate')} on the interview shortlist still need EXCO’s approval. Print the shortlist for EXCO and attach the signed copy.`,
          'EXCO approval', 'interviews');
      } else if (shortlisted.length) {
        next = step('scheduleInterviews', 'Senior_HR_Officer',
          `${plural(shortlisted.length, 'shortlisted candidate')} still to schedule.`, 'schedule interviews', 'interviews');
      } else if (scheduled) {
        next = step('interviewsBooked', null, `${plural(scheduled, 'interview')} booked.`, 'interviews', 'interviews', { who: 'Interview panel' });
      } else {
        next = step('proposeMerit', 'Senior_HR_Officer',
          'Every interview has a verdict. Rank the candidates on the merit list and propose it.', 'propose merit list', 'merit');
      }
    } else if (awaitingExco.length) {
      stepIndex = 3;
      stage = { label: 'EXCO approval', tone: 'warn' };
      next = step('attachExco', 'Senior_HR_Officer',
        `Print the interview shortlist for EXCO and attach the signed copy (${plural(awaitingExco.length, 'candidate')}).`, 'EXCO approval', 'interviews');
    } else if (shortlisted.length) {
      stepIndex = 4;
      stage = { label: 'Interviews', tone: 'info' };
      next = step('scheduleInterviews', 'Senior_HR_Officer',
        `EXCO has approved the interview shortlist. Schedule ${plural(shortlisted.length, 'interview')}.`, 'schedule interviews', 'interviews');
    } else if (proposed.length) {
      stepIndex = 2;
      stage = { label: 'Shortlist for approval', tone: 'warn' };
      next = step('approveShortlist', 'Principal_HR_Officer',
        `${plural(proposed.length, 'candidate')} proposed for interview. Approve the interview shortlist.`, 'approve shortlist', 'committee',
        { excludeStaffIds: [...new Set(proposed.map((a) => a.shortlistProposedById).filter(Boolean))] });
    } else if (exercise) {
      stepIndex = 2;
      if (exercise.status === 'Setup') {
        const n = exercise.nominationStatus;
        stage = { label: n === 'Submitted' ? 'Committee awaiting DHRA' : 'Committee setup', tone: n === 'Submitted' || n === 'Returned' ? 'warn' : 'info' };
        if (n === 'Submitted') {
          next = step('approveCommittee', 'Director', 'The shortlisting committee is waiting for the DHRA’s approval.', 'committee approval', 'committee',
            { excludeStaffIds: [exercise.nominationSubmittedById].filter(Boolean), since: exercise.nominationSubmittedAt });
        } else if (n === 'Returned') {
          next = step('reviseCommittee', 'Senior_HR_Officer', 'The DHRA returned the committee. Change the members and submit it again.', 'revise committee', 'committee');
        } else if (n === 'Approved') {
          next = step('openRating', 'Senior_HR_Officer', 'The DHRA approved the committee. Open rating so the members can start.', 'open rating', 'committee');
        } else {
          next = step('committeeSetup', 'Senior_HR_Officer', 'Finish the assessment sheet and the members, then submit the committee to the DHRA.', 'committee setup', 'committee');
        }
      } else if (exercise.status === 'Rating') {
        stage = { label: 'Committee · rating', tone: 'info' };
        next = step('committeeRating', null, 'The committee members are rating the applicants.', 'ratings', 'committee', { who: 'Committee' });
      } else if (exercise.status === 'Moderation') {
        stage = { label: 'Committee · moderation', tone: 'info' };
        next = step('committeeModeration', null, 'The chair is ruling on the disputed criteria before the exercise can close.', 'moderation', 'committee', { who: 'Committee chair' });
      } else {
        stage = { label: 'Committee closed', tone: 'info' };
        next = step('proposeShortlist', 'Senior_HR_Officer', 'The committee has closed. Propose the interview shortlist from its ranking.', 'propose shortlist', 'committee');
      }
    } else if (!apps.length) {
      stepIndex = 1;
      stage = { label: 'No applicants', tone: 'warn' };
      next = step('noApplicants', 'HR_Officer', 'Nobody applied. Readvertise it or close it.', 'readvertise or close', 'overview');
    } else if (count('Submitted') && !vacancy.reviewStartedAt) {
      stepIndex = 2;
      stage = { label: 'Ready for review', tone: 'info' };
      next = step('beginReview', 'Senior_HR_Officer',
        `Applications closed with ${plural(apps.length, 'applicant')}. Begin review to screen them, then set up the shortlisting committee.`, 'begin review', 'committee');
    } else {
      stepIndex = 2;
      stage = { label: 'Shortlisting', tone: 'info' };
      next = step('committeeSetup', 'Senior_HR_Officer', 'Set up the shortlisting committee for these applicants.', 'committee setup', 'committee');
    }
  }

  const steps = STEPS.map((s, i) => {
    let state = 'todo';
    if (stepIndex != null) state = i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'todo';
    if (vacancy.status === 'Filled' && i < 7) state = 'done';
    if (vacancy.status === 'Filled' && i === 7) state = hired >= posts ? 'done' : 'now';
    const detail = s.key === 'advertised' && stepIndex != null && stepIndex >= 1 ? String(apps.length)
      : s.key === 'offers' ? `${accepted}/${posts}`
        : s.key === 'hired' ? `${hired}/${posts}` : null;
    return { ...s, state, detail };
  });

  return {
    stage,
    stepIndex,
    steps,
    next,
    waitingOn: next ? `${next.who}${next.short ? ` · ${next.short}` : ''}` : null,
    counts: { applicants: apps.length, accepted, hired, posts }
  };
}

/** The facts computeProgress needs, for many vacancies at once (three queries). */
async function loadFacts(vacancyIds, now = new Date()) {
  const byVacancy = new Map(vacancyIds.map((id) => [id, { applications: [], exercise: null, resultsDue: 0 }]));
  if (!vacancyIds.length) return byVacancy;
  const [applications, exercises, dueRounds] = await Promise.all([
    prisma.application.findMany({
      where: { vacancyId: { in: vacancyIds }, status: { not: 'Draft' } },
      select: {
        id: true, vacancyId: true, status: true, excoApprovalId: true, shortlistProposedById: true,
        meritStatus: true, meritListStatus: true, meritProposedById: true, meritProposedAt: true,
        candidate: { select: { fullName: true } },
        offer: { select: { id: true, status: true, recommendedById: true, recommendedDate: true, responseDeadline: true } },
        hire: { select: { id: true } },
        _count: { select: { interviewRounds: true } }
      }
    }),
    prisma.shortlistExercise.findMany({
      where: { vacancyId: { in: vacancyIds } },
      select: { vacancyId: true, status: true, nominationStatus: true, nominationSubmittedById: true, nominationSubmittedAt: true }
    }),
    prisma.interviewRound.findMany({
      where: { status: 'Scheduled', scheduledDate: { lt: now }, application: { vacancyId: { in: vacancyIds } } },
      select: { application: { select: { vacancyId: true } } }
    })
  ]);
  for (const a of applications || []) {
    byVacancy.get(a.vacancyId)?.applications.push({ ...a, hasRounds: (a._count?.interviewRounds || 0) > 0 });
  }
  for (const e of exercises || []) {
    const f = byVacancy.get(e.vacancyId);
    if (f) f.exercise = e;
  }
  for (const r of dueRounds || []) {
    const f = byVacancy.get(r.application?.vacancyId);
    if (f) f.resultsDue += 1;
  }
  return byVacancy;
}

/** Map of vacancy id -> progress, for vacancy rows already loaded. */
async function progressFor(vacancies, now = new Date()) {
  const facts = await loadFacts(vacancies.map((v) => v.id), now);
  return new Map(vacancies.map((v) => [v.id, computeProgress(v, facts.get(v.id), now)]));
}

module.exports = { STEPS, STEP_INDEX, WHO, computeProgress, loadFacts, progressFor };
