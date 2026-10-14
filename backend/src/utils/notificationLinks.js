const prisma = require('../config/db');

// Where a staff notification takes its reader - a path in the staff app.
// An approval opens in the Inbox, straight onto its review panel
// (/hr/inbox?item=<inbox item key>, inboxService's keys); `fallback` is
// where to go when it is no longer waiting there (someone else dealt with
// it). Everything else opens where the work is: the vacancy's tab, the
// interview, the organisation item.
//
// Set when a notification is sent (Notification.link); rows from before
// have none and get theirs from linkFor when they are read.

const inboxItem = (key, fallback) => `/hr/inbox?item=${encodeURIComponent(key)}${fallback ? `&fallback=${encodeURIComponent(fallback)}` : ''}`;
const vacancyTab = (id, tab) => (id ? `/hr/vacancy/${id}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}` : '/hr');

const ORG_PAGES = { DirectorateApproval: ['directorate', 'directorates'], DepartmentApproval: ['department', 'departments'], PositionApproval: ['position', 'positions'] };

// The vacancy behind an offer, application, interview round or committee.
async function vacancyIdOf(model, id) {
  if (!id) return null;
  try {
    if (model === 'offer') return (await prisma.offer.findUnique({ where: { id }, select: { application: { select: { vacancyId: true } } } }))?.application?.vacancyId || null;
    if (model === 'application') return (await prisma.application.findUnique({ where: { id }, select: { vacancyId: true } }))?.vacancyId || null;
    if (model === 'exercise') return (await prisma.shortlistExercise.findUnique({ where: { id }, select: { vacancyId: true } }))?.vacancyId || null;
  } catch {
    return null;
  }
  return null;
}

/** The path for a notification of this type about this task. Never throws. */
async function linkFor(taskType, taskId) {
  switch (taskType) {
    case 'VacancyApproval':
      return inboxItem(`vacancy-${taskId}-approveVacancy`, vacancyTab(taskId));
    case 'ShortlistProposed':
      return inboxItem(`vacancy-${taskId}-approveShortlist`, vacancyTab(taskId, 'committee'));
    case 'MeritListProposed':
      return inboxItem(`vacancy-${taskId}-approveMerit`, vacancyTab(taskId, 'merit'));
    case 'OfferApproval':
      return inboxItem(`offer-${taskId}`, vacancyTab(await vacancyIdOf('offer', taskId), 'merit'));
    case 'CommitteeNominationSubmitted': {
      const vacancyId = await vacancyIdOf('exercise', taskId);
      return vacancyId ? inboxItem(`vacancy-${vacancyId}-approveCommittee`, vacancyTab(vacancyId, 'committee')) : '/hr/inbox';
    }
    case 'DirectorateApproval':
    case 'DepartmentApproval':
    case 'PositionApproval': {
      const [entity, page] = ORG_PAGES[taskType];
      return inboxItem(`${entity}-${taskId}`, `/hr/organisation/${page}?open=${taskId}`);
    }
    case 'DataErasureRequested':
      return inboxItem(`data-request-${taskId}`, '/hr/settings');
    case 'CommitteeNominationDecided':
      return vacancyTab(await vacancyIdOf('exercise', taskId), 'committee');
    case 'VacancyReturned':
    case 'VacancyRejected':
    case 'StaffApplicantConflict':
      return vacancyTab(taskId);
    case 'VacancyDeadlinePassed':
      return vacancyTab(taskId, 'applicants');
    case 'NewApplicationSubmitted':
    case 'ApplicationWithdrawn':
      return vacancyTab(await vacancyIdOf('application', taskId), 'applicants');
    case 'OfferReturned':
    case 'OfferDeclined':
    case 'OfferExpired':
      return vacancyTab(await vacancyIdOf('offer', taskId), 'merit');
    case 'VacancyFilledWithOpenOffers':
      return '/hr/offers';
    case 'InterviewRescheduleRequested':
    case 'InterviewResultsOverdue':
    case 'InterviewReadyToFinalize':
    case 'InterviewScoresOverdue':
    case 'InterviewSessionNotStarted':
      return taskId ? `/hr/interviews?round=${taskId}` : '/hr/interviews';
    default:
      // SystemHealthAlert (its banner is on the Inbox), PendingApprovalsDigest.
      return '/hr/inbox';
  }
}

module.exports = { linkFor, inboxItem, vacancyTab };
