// What each change request is, in plain words, for the activity log
// (services/activityLogService.js) - keyed by method and route pattern.
// A route missing here is described from its pattern (describeRoute), so
// adding a route never breaks the log - but give it words here.

const ACTIONS = {
  // Signing in
  'POST /api/staff/auth/entra': 'Staff sign-in (Microsoft)',
  'POST /api/staff/auth/login': 'Staff sign-in (password)',
  'POST /api/candidates/auth/entra': 'Candidate sign-in (Microsoft)',
  'POST /api/candidates/auth/login': 'Candidate sign-in (password)',
  'POST /api/candidates/auth/register': 'Candidate registration',
  'POST /api/candidates/auth/forgot-password': 'Candidate password reset requested',
  'POST /api/candidates/auth/reset-password': 'Candidate password reset',

  // Applications
  'POST /api/applications': 'Application draft started',
  'PATCH /api/applications/:id/submit': 'Application submitted',
  'PATCH /api/applications/:id/withdraw': 'Application withdrawn',
  'POST /api/applications/:id/documents': 'Application document uploaded',
  'DELETE /api/applications/:id/documents/:documentId': 'Application document removed',
  'PATCH /api/applications/:id/shortlist': 'Applicant proposed for the interview shortlist',
  'PATCH /api/applications/:id/reject': 'Application rejected',
  'PATCH /api/applications/:id/reinstate': 'Application reinstated',
  'POST /api/applications/vacancies/:vacancyId/approve-shortlist': 'Interview shortlist approved',
  'POST /api/applications/vacancies/:vacancyId/merit-list': 'Merit list proposed',
  'POST /api/applications/vacancies/:vacancyId/merit-list/approve': 'Merit list approved',
  'PATCH /api/verification/candidates/:candidateId/verify': 'Internal candidate employment checked',

  // Offers and hires
  'POST /api/applications/:id/recommend-offer': 'Offer recommended',
  'PATCH /api/applications/offers/:offerId': 'Offer revised',
  'PATCH /api/applications/offers/:offerId/approve': 'Offer approved and issued',
  'PATCH /api/applications/offers/:offerId/return': 'Offer returned for revision',
  'PATCH /api/applications/offers/:offerId/accept': 'Offer accepted by the candidate',
  'PATCH /api/applications/offers/:offerId/decline': 'Offer declined by the candidate',
  'PATCH /api/applications/offers/:offerId/withdraw': 'Offer withdrawn',
  'POST /api/applications/offers/:offerId/hire': 'Marked as hired',
  'DELETE /api/applications/offers/:offerId/hire': 'Hire cancelled',
  'POST /api/applications/offers/:offerId/hire/retry': 'Hire re-sent to the HRIS',

  // Vacancies
  'POST /api/vacancies/requisition': 'Requisition uploaded and read',
  'POST /api/vacancies/requisition/signed-copy': 'Signed requisition uploaded',
  'POST /api/vacancies': 'Vacancy created',
  'PATCH /api/vacancies/:id': 'Vacancy edited',
  'PATCH /api/vacancies/:id/close': 'Vacancy closed',
  'PATCH /api/vacancies/:id/begin-review': 'Review of applications begun',
  'PATCH /api/vacancies/:id/approve': 'Vacancy approved',
  'PATCH /api/vacancies/:id/return': 'Vacancy returned for revision',
  'PATCH /api/vacancies/:id/reject': 'Vacancy rejected',
  'PATCH /api/vacancies/:id/resubmit': 'Vacancy resubmitted for approval',
  'PATCH /api/vacancies/:id/transition-posting-type': 'Vacancy posting type changed',
  'POST /api/vacancies/:id/readvertise': 'Vacancy readvertised',
  'POST /api/vacancies/:id/exco-shortlist': 'EXCO shortlist approval attached',
  'POST /api/vacancies/:id/rank': 'Interview shortlist ranked and proposed',
  'POST /api/vacancy-drafts': 'Vacancy draft saved',
  'DELETE /api/vacancy-drafts/:id': 'Vacancy draft deleted',

  // Interviews
  'POST /api/interviews/vacancies/:vacancyId/plan': 'Interview session planned (dry run)',
  'POST /api/interviews/vacancies/:vacancyId/sessions': 'Interview session booked',
  'POST /api/interviews/applications/:applicationId/interviews': 'Interview scheduled',
  'PATCH /api/interviews/panel-members/:panelMemberId': 'Interview panelist edited',
  'DELETE /api/interviews/panel-members/:panelMemberId': 'Interview panelist removed',
  'PATCH /api/interviews/:interviewId': 'Interview details edited',
  'PATCH /api/interviews/:interviewId/reschedule': 'Interview rescheduled',
  'PATCH /api/interviews/:interviewId/cancel': 'Interview cancelled',
  'PATCH /api/interviews/:interviewId/no-show': 'Interview marked no-show',
  'POST /api/interviews/:interviewId/panel-members': 'Interview panelist added',
  'PATCH /api/interviews/:interviewId/results': 'Interview results recorded',
  'PATCH /api/candidates/me/interviews/:id/respond': 'Candidate answered an interview invitation',

  // Candidate profile
  'PUT /api/candidates/me': 'Candidate profile updated',
  'POST /api/candidates/me/work-experience': 'Candidate work experience added',
  'PUT /api/candidates/me/work-experience/:id': 'Candidate work experience edited',
  'DELETE /api/candidates/me/work-experience/:id': 'Candidate work experience removed',
  'POST /api/candidates/me/education': 'Candidate education added',
  'PUT /api/candidates/me/education/:id': 'Candidate education edited',
  'DELETE /api/candidates/me/education/:id': 'Candidate education removed',
  'POST /api/candidates/me/certificates': 'Candidate certificate added',
  'PUT /api/candidates/me/certificates/:id': 'Candidate certificate edited',
  'DELETE /api/candidates/me/certificates/:id': 'Candidate certificate removed',
  'POST /api/candidates/me/exam-grades': 'Candidate exam grade added',
  'PUT /api/candidates/me/exam-grades/:id': 'Candidate exam grade edited',
  'DELETE /api/candidates/me/exam-grades/:id': 'Candidate exam grade removed',
  'PUT /api/candidates/me/internal-profile': 'Candidate UCAA employment details updated',
  'PUT /api/candidates/me/photo': 'Candidate photo uploaded',
  'DELETE /api/candidates/me/photo': 'Candidate photo removed',
  'POST /api/candidates/me/data-requests': 'Candidate asked for their data to be erased',
  'POST /api/candidates/me/parse-cv': 'Candidate CV read to fill in the profile',

  // Shortlisting committee
  'POST /api/shortlist-committee/vacancies/:vacancyId': 'Shortlisting committee set up',
  'PATCH /api/shortlist-committee/vacancies/:vacancyId': 'Shortlisting committee assessment sheet edited',
  'POST /api/shortlist-committee/vacancies/:vacancyId/nomination/submit': 'Committee submitted to the DHRA',
  'POST /api/shortlist-committee/vacancies/:vacancyId/nomination/approve': 'Committee approved by the DHRA',
  'POST /api/shortlist-committee/vacancies/:vacancyId/nomination/return': 'Committee returned by the DHRA',
  'POST /api/shortlist-committee/vacancies/:vacancyId/members': 'Committee member added',
  'PATCH /api/shortlist-committee/vacancies/:vacancyId/members/:memberId': 'Committee member edited',
  'DELETE /api/shortlist-committee/vacancies/:vacancyId/members/:memberId': 'Committee member removed',
  'POST /api/shortlist-committee/vacancies/:vacancyId/members/:memberId/link': 'Committee member link re-sent',
  'POST /api/shortlist-committee/vacancies/:vacancyId/open': 'Committee rating opened',
  'POST /api/shortlist-committee/vacancies/:vacancyId/assignments': 'Committee rater added',
  'PUT /api/shortlist-committee/vacancies/:vacancyId/acting-chairs': 'Committee acting chair named',
  'POST /api/shortlist-committee/vacancies/:vacancyId/moderation': 'Committee moved to moderation',
  'POST /api/shortlist-committee/vacancies/:vacancyId/close': 'Committee exercise closed',
  'POST /api/shortlist-committee/vacancies/:vacancyId/propose': 'Interview shortlist proposed from the committee ranking',
  'PUT /api/shortlist-panel/:token/applicants/:applicationId/ratings': 'Committee member rated an applicant',
  'POST /api/shortlist-panel/:token/applicants/:applicationId/conflict': 'Committee member stood down from an applicant',
  'POST /api/shortlist-panel/:token/submit': 'Committee member submitted their ratings',
  'PUT /api/shortlist-panel/:token/decisions': 'Committee chair ruled on disputed items',

  // Organisation
  'POST /api/directorates': 'Directorate added',
  'PATCH /api/directorates/:id/approve': 'Directorate approved',
  'PATCH /api/directorates/:id/reject': 'Directorate rejected',
  'PATCH /api/directorates/:id': 'Directorate edited',
  'DELETE /api/directorates/:id': 'Directorate deleted',
  'POST /api/departments': 'Department added',
  'PATCH /api/departments/imports/:importId/approve': 'Organisation import approved',
  'PATCH /api/departments/:id/approve': 'Department approved',
  'PATCH /api/departments/:id/reject': 'Department rejected',
  'PATCH /api/departments/:id': 'Department edited',
  'DELETE /api/departments/:id': 'Department deleted',
  'POST /api/positions': 'Position added',
  'PATCH /api/positions/:id/approve': 'Position approved',
  'PATCH /api/positions/:id/reject': 'Position rejected',
  'PATCH /api/positions/:id': 'Position edited',
  'DELETE /api/positions/:id': 'Position deleted',
  'PUT /api/positions/:id/headcount': 'Position headcount set',
  'POST /api/org-import/preview': 'Organisation import checked',
  'POST /api/org-import': 'Organisation imported',

  // Accounts, delegations, settings
  'POST /api/staff-users': 'Staff account created',
  'PATCH /api/staff-users/:id': 'Staff account changed',
  'POST /api/staff-users/:id/unlink': 'Staff account unlinked from Microsoft',
  'POST /api/staff-users/:id/entra-group': 'Staff app group update retried',
  'PATCH /api/staff-users/hr-team/:id/role': 'HR role changed by HR Manager',
  'POST /api/delegations': 'Delegation granted',
  'PUT /api/settings/:key': 'Setting changed',
  'PUT /api/documents/templates/:key': 'Document template saved',
  'DELETE /api/documents/templates/:key': 'Document template reset',
  'POST /api/documents/templates/:key/preview': 'Document template previewed',
  'PATCH /api/data-protection/requests/:id/complete': 'Data erasure request completed',
  'PATCH /api/data-protection/requests/:id/refuse': 'Data erasure request refused',

  // Candidates database and email
  'POST /api/talent/tags': 'Candidate tag created',
  'DELETE /api/talent/tags/:tagId': 'Candidate tag deleted',
  'POST /api/talent/candidates/:candidateId/tags': 'Candidate tagged',
  'DELETE /api/talent/candidates/:candidateId/tags/:tagId': 'Candidate tag removed',
  'POST /api/bulk-email/preview': 'Bulk email previewed',
  'POST /api/bulk-email/send': 'Bulk email sent'
};

// Requests not worth a row: reading notifications, and the vacancy form's
// auto-save every few seconds (the draft's creation and deletion are kept).
const SKIPPED = new Set([
  'PATCH /api/notifications/read-all',
  'PATCH /api/notifications/:id/read',
  'PATCH /api/candidates/me/notifications/:id/read',
  'PUT /api/vacancy-drafts/:id'
]);

// "POST /api/widgets/:id/frobnicate" -> "Widgets: frobnicate".
function describeRoute(method, route) {
  const parts = String(route || '').replace(/^\/api\//, '').split('/').filter((p) => p && !p.startsWith(':'));
  if (!parts.length) return `${method} request`;
  const what = parts[0].replace(/-/g, ' ');
  const verb = parts.length > 1 ? parts[parts.length - 1].replace(/-/g, ' ') : { POST: 'created', PUT: 'saved', PATCH: 'changed', DELETE: 'deleted' }[method] || method;
  return `${what[0].toUpperCase()}${what.slice(1)}: ${verb}`;
}

function actionFor(method, route) {
  return ACTIONS[`${method} ${route}`] || describeRoute(method, route);
}

const skipped = (method, route) => SKIPPED.has(`${method} ${route}`);

module.exports = { ACTIONS, actionFor, describeRoute, skipped };
