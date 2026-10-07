const prisma = require('../config/db');
const { ROLE_RANK } = require('../middleware/auth');
const delegationModel = require('../models/delegationModel');
const audit = require('./auditService');
const slaModel = require('../models/slaModel');
const { AppError } = require('../utils/errorResponse');

// The one approval rule for the organisation structure - directorates,
// departments and positions, added one at a time or by a spreadsheet import:
//
//   - A Principal HR Officer or above (own role or an active delegation)
//     approves what they add at once - the form's "Approve now" box, ticked by
//     default. Unticked (autoApprove: false), it waits for approval like
//     anyone else's.
//   - Everything else arrives Pending, for a Principal HR Officer or above
//     who did not add it (nobody approves their own).
//   - Only an Approved item whose department and directorate are Approved
//     too can be used on a vacancy (usablePosition).
//
// Editing and deleting afterwards: orgAdminService.js.
//
// Every creation, approval and rejection is written to the audit trail
// (entity types Directorate / Department / Position / OrgImport), saying
// whether "Approve now" was used.

const ENTITY = {
  Directorate: { model: 'directorate', word: 'directorate' },
  Department: { model: 'department', word: 'department' },
  Position: { model: 'position', word: 'position' }
};
const ORG_ENTITY_TYPES = ['Directorate', 'Department', 'Position', 'OrgImport'];

// Whether this person may approve organisation changes: PHRO+ by their own
// role, or while acting under a PHRO+ delegation.
async function approverRights(req) {
  if ((ROLE_RANK[req.user.role] || 0) >= ROLE_RANK.Principal_HR_Officer) return { canApprove: true };
  const delegation = await delegationModel.findActiveForDelegate(req.user.id, new Date());
  if (delegation && (ROLE_RANK[delegation.delegator?.role] || 0) >= ROLE_RANK.Principal_HR_Officer) {
    return { canApprove: true, delegation };
  }
  return { canApprove: false };
}

// "Approve now" is ticked by default: only an explicit false (JSON or a
// multipart field) sends it for approval.
function wantsAutoApprove(body) {
  const v = body?.autoApprove;
  return !(v === false || v === 'false' || v === '0');
}

// The status a new item starts with, and whether it was approved at once.
// Logs the delegation's use when approving under one.
async function initialState(req) {
  const rights = await approverRights(req);
  const autoApproved = rights.canApprove && wantsAutoApprove(req.body);
  if (autoApproved && rights.delegation) {
    await delegationModel.logUsage(rights.delegation.id, `${req.method} ${req.originalUrl} (approved on creation)`);
    req.actingAsDelegateFor = rights.delegation.delegatorId;
  }
  return {
    autoApproved,
    canApprove: rights.canApprove,
    delegation: rights.delegation || null,
    data: autoApproved
      ? { status: 'Approved', approvedById: req.user.id, approvedAt: new Date() }
      : { status: 'Pending' }
  };
}

function creationNote(state) {
  if (state.autoApproved) return 'Approved on creation: "Approve now" was ticked by a Principal HR Officer or above.';
  if (state.canApprove) return '"Approve now" was unticked, so it waits for another Principal HR Officer or above to approve it.';
  return 'Waits for a Principal HR Officer or above to approve it.';
}

async function recordCreated(req, entityType, row, state) {
  await audit.record({
    entityType, entityId: row.id,
    action: state.autoApproved ? 'Created and approved (Approve now)' : 'Created, sent for approval',
    actor: audit.actorFrom(req),
    before: {}, after: row, fields: ['code', 'name', 'status'],
    comment: creationNote(state),
    details: { name: row.name, code: row.code, autoApproved: state.autoApproved, autoApproveAvailable: state.canApprove }
  });
}

const PARENT = {
  Department: async (row) => (await prisma.directorate.findUnique({ where: { id: row.directorateId } })),
  Position: async (row) => (await prisma.department.findUnique({ where: { id: row.departmentId } }))
};

// Approve or reject one pending item. Route-gated to PHRO+ (delegation
// included); here: still pending, not the approver's own, a reason to reject,
// and a rejected parent can't have children approved.
async function decide(req, entityType, id, decision, reason) {
  const { model, word } = ENTITY[entityType];
  if (!Number.isInteger(id)) throw new AppError(`Invalid ${word}`, 400);
  const row = await prisma[model].findUnique({ where: { id } });
  if (!row) throw new AppError(`${word[0].toUpperCase()}${word.slice(1)} not found`, 404);
  if (row.status !== 'Pending') throw new AppError(`This ${word} is not awaiting approval`, 422);
  if (row.createdById === req.user.id) {
    const err = new AppError(`You added this ${word}, so another Principal HR Officer or above must ${decision} it`, 403);
    err.code = 'SELF_APPROVAL';
    throw err;
  }
  const rejecting = decision === 'reject';
  if (rejecting && !(reason && String(reason).trim())) throw new AppError('A rejection reason is required', 400);
  if (!rejecting && PARENT[entityType]) {
    const parent = await PARENT[entityType](row);
    if (parent?.status === 'Rejected') {
      throw new AppError(`Its ${entityType === 'Department' ? 'directorate' : 'department'} was rejected, so this ${word} can't be approved`, 422);
    }
  }

  const data = rejecting
    ? { status: 'Rejected', approvedById: req.user.id, approvedAt: new Date(), rejectionReason: String(reason).trim() }
    : { status: 'Approved', approvedById: req.user.id, approvedAt: new Date(), rejectionReason: null };
  // Conditional on still being Pending, so two approvers can't both decide.
  const { count } = await prisma[model].updateMany({ where: { id, status: 'Pending' }, data });
  if (!count) throw new AppError(`This ${word} was decided by someone else just now`, 409);
  const updated = await prisma[model].findUnique({ where: { id } });
  // Decided: any escalation of its approval deadline is closed.
  await slaModel.resolveEscalations(`${entityType}Approval`, id);

  await audit.record({
    entityType, entityId: id, action: rejecting ? 'Rejected' : 'Approved',
    actor: audit.actorFrom(req),
    before: row, after: updated, fields: ['status', 'rejectionReason'],
    comment: rejecting ? String(reason).trim() : null,
    details: { name: row.name, code: row.code }
  });
  return updated;
}

// Approve everything one import left pending, together (PHRO+, not the
// person who imported it).
async function approveImport(req, importId) {
  if (!Number.isInteger(importId)) throw new AppError('Invalid import', 400);
  const record = await prisma.orgImport.findUnique({ where: { id: importId } });
  if (!record) throw new AppError('Import not found', 404);
  if (record.createdById === req.user.id) {
    const err = new AppError('You ran this import, so another Principal HR Officer or above must approve it', 403);
    err.code = 'SELF_APPROVAL';
    throw err;
  }
  const where = { importId, status: 'Pending' };
  const [directorates, departments, positions] = await Promise.all([
    prisma.directorate.findMany({ where, select: { id: true } }),
    prisma.department.findMany({ where, select: { id: true } }),
    prisma.position.findMany({ where, select: { id: true } })
  ]);
  if (!directorates.length && !departments.length && !positions.length) {
    throw new AppError('Nothing from this import is awaiting approval', 422);
  }
  const data = { status: 'Approved', approvedById: req.user.id, approvedAt: new Date(), rejectionReason: null };
  const [d1, d2, d3] = await prisma.$transaction([
    prisma.directorate.updateMany({ where, data }),
    prisma.department.updateMany({ where, data }),
    prisma.position.updateMany({ where, data })
  ]);
  const result = { directorates: d1.count, departments: d2.count, positions: d3.count, departmentIds: departments.map((d) => d.id) };
  for (const [taskType, rows] of [['DirectorateApproval', directorates], ['DepartmentApproval', departments], ['PositionApproval', positions]]) {
    for (const { id } of rows) await slaModel.resolveEscalations(taskType, id);
  }
  await audit.record({
    entityType: 'OrgImport', entityId: importId, action: 'Approved import',
    actor: audit.actorFrom(req),
    comment: `Approved ${d1.count} directorate(s), ${d2.count} department(s) and ${d3.count} position(s) from ${record.fileName}.`,
    details: { name: record.fileName, directorates: d1.count, departments: d2.count, positions: d3.count }
  });
  return result;
}

// Whether a position (loaded with department.directorate) may be used on a
// vacancy: it, its department and its directorate all Approved.
function usablePosition(position) {
  return Boolean(position && position.status === 'Approved'
    && position.department?.status === 'Approved'
    && position.department?.directorate?.status === 'Approved');
}

// Recent organisation changes, newest first, for the Organisation page.
async function history(limit = 100) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: { in: ORG_ENTITY_TYPES } },
    include: { performedBy: { select: { id: true, name: true, role: true } } },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: limit
  });
  return rows.map((row) => ({
    id: row.id, entityType: row.entityType, entityId: row.entityId, action: row.action, timestamp: row.timestamp,
    performedBy: row.performedBy, actingAsId: row.actingAsId,
    name: row.payload?.name || null,
    code: row.payload?.code || null,
    autoApproved: row.payload?.autoApproved ?? null,
    comment: row.payload?.comment || null
  }));
}

module.exports = {
  approverRights, wantsAutoApprove, initialState, creationNote, recordCreated, decide, approveImport, usablePosition, history, ORG_ENTITY_TYPES
};
