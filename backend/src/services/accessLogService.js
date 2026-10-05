const prisma = require('../config/db');

// FR-ATS-081 - the read side of the audit trail: who viewed candidate data.
// Called by the handlers that show it (applicant lists, the application
// queue, documents, exports, the shortlisting committee's applicant view).
// Like auditService it runs after the response data is ready and never
// throws - a logging failure must not stop HR working.
//
// The HR screens refetch often (every dashboard event), so an identical
// view - same person, action, vacancy/application and candidates - is
// recorded once per THROTTLE_MS. In memory, per API process; a second
// process may record the same view again, which errs on the safe side.

const THROTTLE_MS = 10 * 60 * 1000;
const MAX_REMEMBERED = 5000;
const recent = new Map();

function actorOf(req, committeeMember) {
  if (committeeMember) {
    return { actorType: 'committee', actorLabel: `${committeeMember.name} <${committeeMember.email}>`.slice(0, 191) };
  }
  return { actorType: 'staff', staffUserId: req?.user?.id ?? null };
}

function alreadyRecorded(key, now) {
  const last = recent.get(key);
  if (last && now - last < THROTTLE_MS) return true;
  if (recent.size >= MAX_REMEMBERED) {
    for (const [k, t] of recent) if (now - t >= THROTTLE_MS) recent.delete(k);
    if (recent.size >= MAX_REMEMBERED) recent.clear();
  }
  recent.set(key, now);
  return false;
}

/**
 * record(req, { action, vacancyId, applicationId, candidateIds, detail, committeeMember })
 */
async function record(req, { action, vacancyId = null, applicationId = null, candidateIds = [], detail, committeeMember } = {}) {
  const actor = actorOf(req, committeeMember);
  const ids = [...new Set(candidateIds.filter(Number.isInteger))].sort((a, b) => a - b);
  const key = JSON.stringify([actor.actorType, actor.staffUserId, actor.actorLabel, action, vacancyId, applicationId, ids, detail?.filename]);
  if (alreadyRecorded(key, Date.now())) return;
  try {
    await prisma.dataAccessLog.create({
      data: {
        ...actor, action, vacancyId, applicationId,
        candidateIds: ids.length ? ids : undefined,
        detail: detail || undefined,
        ip: String(req?.ip || '').slice(0, 64) || null
      }
    });
  } catch (err) {
    console.error(`Failed to write the data access log (${action}):`, err);
  }
}

// Every recorded view of one application's candidate - views of the
// application itself and of lists, documents and exports that included them.
async function forApplication(applicationId, candidateId, take = 200) {
  const rows = await prisma.dataAccessLog.findMany({
    where: { OR: [{ applicationId }, { candidateIds: { array_contains: [candidateId] } }] },
    orderBy: { at: 'desc' },
    take
  });
  const staffIds = [...new Set(rows.map((r) => r.staffUserId).filter(Boolean))];
  const staff = staffIds.length
    ? await prisma.staffUser.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true, role: true } })
    : [];
  const byId = new Map(staff.map((s) => [s.id, s]));
  return rows.map((r) => ({
    id: r.id, at: r.at, action: r.action, vacancyId: r.vacancyId, applicationId: r.applicationId,
    who: r.actorType === 'committee' ? `${r.actorLabel} (shortlisting committee)` : byId.get(r.staffUserId)?.name || 'A staff member',
    role: byId.get(r.staffUserId)?.role || null,
    document: r.detail?.document || null
  }));
}

function resetThrottle() {
  recent.clear();
}

module.exports = { record, forApplication, resetThrottle, THROTTLE_MS };
