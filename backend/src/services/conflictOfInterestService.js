const prisma = require('../config/db');

// A UCAA employee can be both a staff member and a candidate: the same
// person has a StaffUser (staff portal) and an Internal Candidate (candidate
// site), linked through their Microsoft identity (entraObjectId) or, failing
// that, their UCAA email. Once a staff member has applied for a vacancy they
// take no part in running it - no shortlisting, interviews, merit list,
// offers or screening decisions, and no view of the other applicants - while
// their work on every other vacancy is unaffected. A staff member acting
// under a delegation is also shut out of the vacancies their delegator
// applied for.
//
// "Applied" means any application past Draft, including a withdrawn one:
// having competed for the post, withdrawing doesn't make them impartial.

const CONFLICT_STATUSES_EXCLUDED = ['Draft'];

class ApplicantConflictError extends Error {
  constructor() {
    super('You have applied for this vacancy, so you cannot take part in running it. Another member of HR must handle it.');
    this.status = 409;
    this.code = 'APPLICANT_CONFLICT';
  }
}

// The candidate accounts belonging to a staff member - by Microsoft
// identity, and by email for accounts not linked yet.
function candidateMatchFor(staff) {
  const or = [{ email: staff.email }];
  if (staff.entraObjectId) or.push({ entraObjectId: staff.entraObjectId });
  return { OR: or };
}

// Vacancy ids the given staff member has applied for.
async function vacancyIdsAppliedForByStaff(staffId) {
  if (!staffId) return [];
  const staff = await prisma.staffUser.findUnique({
    where: { id: staffId }, select: { email: true, entraObjectId: true }
  });
  if (!staff) return [];
  const applications = await prisma.application.findMany({
    where: { status: { notIn: CONFLICT_STATUSES_EXCLUDED }, candidate: candidateMatchFor(staff) },
    select: { vacancyId: true }
  });
  return [...new Set(applications.map((a) => a.vacancyId))];
}

// The other way round: the staff members who applied for a vacancy - left
// out of anything sent about its applicants.
async function staffIdsAppliedFor(vacancyId) {
  const candidates = await prisma.candidate.findMany({
    where: { applications: { some: { vacancyId, status: { notIn: CONFLICT_STATUSES_EXCLUDED } } } },
    select: { email: true, entraObjectId: true }
  });
  if (!candidates.length) return [];
  const or = candidates.flatMap((c) => [{ email: c.email }, ...(c.entraObjectId ? [{ entraObjectId: c.entraObjectId }] : [])]);
  const staff = await prisma.staffUser.findMany({ where: { OR: or }, select: { id: true } });
  return staff.map((s) => s.id);
}

// The vacancies the requester is shut out of: their own applications, and
// their delegator's when this request runs under a delegation. Worked out
// once per request.
async function conflictedVacancyIds(req) {
  if (req.user?.type !== 'staff') return [];
  if (!req._conflictedVacancyIds) {
    const ids = new Set(await vacancyIdsAppliedForByStaff(req.user.id));
    if (req.actingAsDelegateFor) {
      for (const id of await vacancyIdsAppliedForByStaff(req.actingAsDelegateFor)) ids.add(id);
    }
    req._conflictedVacancyIds = [...ids];
  }
  return req._conflictedVacancyIds;
}

async function isConflicted(req, vacancyId) {
  if (!vacancyId) return false;
  return (await conflictedVacancyIds(req)).includes(Number(vacancyId));
}

async function assertNotApplicant(req, vacancyId) {
  if (await isConflicted(req, vacancyId)) throw new ApplicantConflictError();
}

// The staff account (if any) behind a candidate - for flagging a staff
// member's application to the other Principal HR Officers.
async function staffForCandidate(candidate) {
  const or = [{ email: candidate.email }];
  if (candidate.entraObjectId) or.push({ entraObjectId: candidate.entraObjectId });
  return prisma.staffUser.findFirst({ where: { OR: or }, select: { id: true, name: true, role: true } });
}

// When a staff member submits an application: tell the other Principal HR
// Officers (or, if there are none, the Managers) so someone else runs the
// vacancy, and record it on the vacancy's audit trail. The rule itself needs
// no flag - it is worked out from the application on every request.
async function flagStaffApplicant(candidate, vacancy, applicationId) {
  const staff = await staffForCandidate(candidate);
  if (!staff) return null;
  const { notify } = require('./notificationService');
  const audit = require('./auditService');

  const others = (role) => prisma.staffUser.findMany({
    where: { role, active: true, id: { not: staff.id } }, select: { id: true }
  });
  let recipients = await others('Principal_HR_Officer');
  if (!recipients.length) recipients = await others('Manager');
  const role = staff.role ? staff.role.replace(/_/g, ' ') : 'system administrator';
  const message = `${staff.name} (staff, ${role}) applied for "${vacancy.title}" (${vacancy.jobRef}). `
    + 'They are shut out of running this vacancy - make sure someone else handles it.';
  for (const r of recipients) await notify(r.id, 'StaffApplicantConflict', vacancy.id, message);

  await audit.record({
    entityType: 'Vacancy', entityId: vacancy.id, action: 'Staff member applied',
    details: { staffUserId: staff.id, applicationId }
  });
  return staff;
}

module.exports = {
  ApplicantConflictError,
  flagStaffApplicant,
  vacancyIdsAppliedForByStaff,
  staffIdsAppliedFor,
  conflictedVacancyIds,
  isConflicted,
  assertNotApplicant,
  staffForCandidate
};
