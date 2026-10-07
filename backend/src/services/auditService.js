const prisma = require('../config/db');

// One way to write the audit trail (FR-ATS-012, FR-ATS-081, BR-ATS-13):
// who acted (and under whose delegation), when, what they did, the values
// before and after, and their comment. Everything beyond the actor and the
// action goes in AuditLog.payload:
//   { changes: { field: { from, to } }, comment, actor, ...details }
// `actor` is only set for a candidate's own action - AuditLog.performedById
// points at StaffUser, and candidate and staff ids are separate sequences.
//
// Called after the action itself has committed, so a failure to write the
// row is logged rather than thrown: turning a successful action into a 500
// would have the client retry it and hit the "already updated" 409.

// The staff member (and delegation) behind a request, or the candidate.
function actorFrom(req) {
  if (req?.user?.type === 'candidate') return { candidateId: req.user.id };
  return { performedById: req?.user?.id ?? null, actingAsId: req?.actingAsDelegateFor ?? null };
}

function comparable(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

// { field: { from, to } } for each of `fields` (default: every key of
// `after`) whose value differs. Dates and JSON columns compare by value.
function diff(before, after, fields = Object.keys(after || {})) {
  const changes = {};
  for (const field of fields) {
    const from = comparable(before?.[field]);
    const to = comparable(after?.[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

async function record({ entityType, entityId, action, actor = {}, before, after, fields, comment, details } = {}) {
  const payload = { ...(details || {}) };
  if (before !== undefined || after !== undefined) {
    const changes = diff(before, after, fields);
    if (Object.keys(changes).length) payload.changes = changes;
  }
  if (comment) payload.comment = comment;
  if (actor.candidateId) payload.actor = { type: 'candidate', id: actor.candidateId };

  try {
    await prisma.auditLog.create({
      data: {
        entityType, entityId, action,
        performedById: actor.performedById ?? null,
        actingAsId: actor.actingAsId ?? null,
        payload: Object.keys(payload).length ? payload : undefined
      }
    });
  } catch (err) {
    console.error(`Failed to write audit row (${entityType} ${entityId}: ${action}):`, err);
  }
}

// Audit several entities for one action (e.g. every application a
// shortlist approval moved).
async function recordMany(entries) {
  for (const entry of entries) await record(entry);
}

// The entity types staff can read a history for, via GET /api/audit.
const HISTORY_ENTITY_TYPES = ['Vacancy', 'Application', 'Offer', 'InterviewRound', 'Directorate', 'Department', 'Position', 'OrgImport'];

async function history(entityType, entityId) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    include: { performedBy: { select: { id: true, name: true, role: true } } },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }]
  });
  return rows.map((row) => ({
    id: row.id, action: row.action, timestamp: row.timestamp,
    performedBy: row.performedBy, actingAsId: row.actingAsId,
    changes: row.payload?.changes || null,
    comment: row.payload?.comment || null,
    byCandidate: row.payload?.actor?.type === 'candidate'
  }));
}

module.exports = { actorFrom, diff, record, recordMany, history, HISTORY_ENTITY_TYPES };
