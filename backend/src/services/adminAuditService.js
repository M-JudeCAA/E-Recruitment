const prisma = require('../config/db');
const { dayBounds } = require('../utils/interviewFormat');

// The system administrator's audit log (/api/admin/audit, AuditLogPage.jsx):
// three records of who did what, when and from where, each searchable.
//   activity - every change request and sign-in attempt, with its outcome
//              (ActivityLog, activityLogService)
//   changes  - the audit trail: what changed, from what to what, and the
//              comment (AuditLog, auditService), with the request it came from
//   access   - who viewed candidate data (DataAccessLog, accessLogService)
// Filters (all optional): from/to (days in APP_TIMEZONE), staffUserId,
// actorType, ip (contains), outcome (activity), entityType/entityId
// (changes), requestId (everything one request did), q (free text across
// the actor, action, path and address).

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function paging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

// { gte, lt } for the from/to days, inclusive, in APP_TIMEZONE.
function range(query) {
  const r = {};
  if (DAY_RE.test(query.from || '')) r.gte = dayBounds(query.from).start;
  if (DAY_RE.test(query.to || '')) r.lt = dayBounds(query.to).end;
  return Object.keys(r).length ? r : undefined;
}

const text = (value) => String(value || '').trim().slice(0, 200);
const id = (value) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };

function activityWhere(query) {
  const where = {};
  const at = range(query);
  if (at) where.at = at;
  if (id(query.staffUserId)) where.staffUserId = id(query.staffUserId);
  if (text(query.actorType)) where.actorType = text(query.actorType);
  if (['success', 'refused', 'failed'].includes(query.outcome)) where.outcome = query.outcome;
  if (text(query.ip)) where.ipAddress = { contains: text(query.ip) };
  if (query.signIns === 'true') where.route = { contains: '/auth/' };
  if (text(query.requestId)) where.requestId = text(query.requestId);
  const q = text(query.q);
  if (q) where.OR = [{ actorLabel: { contains: q } }, { action: { contains: q } }, { path: { contains: q } }, { ipAddress: { contains: q } }];
  return where;
}

function changesWhere(query) {
  const where = {};
  const timestamp = range(query);
  if (timestamp) where.timestamp = timestamp;
  if (id(query.staffUserId)) where.performedById = id(query.staffUserId);
  if (text(query.actorType)) where.actorType = text(query.actorType);
  if (text(query.entityType)) where.entityType = text(query.entityType);
  if (id(query.entityId)) where.entityId = id(query.entityId);
  if (text(query.requestId)) where.requestId = text(query.requestId);
  if (text(query.ip)) where.ipAddress = { contains: text(query.ip) };
  const q = text(query.q);
  if (q) where.OR = [{ action: { contains: q } }, { actorLabel: { contains: q } }, { entityType: { contains: q } }, { requestPath: { contains: q } }, { ipAddress: { contains: q } }];
  return where;
}

function accessWhere(query) {
  const where = {};
  const at = range(query);
  if (at) where.at = at;
  if (id(query.staffUserId)) where.staffUserId = id(query.staffUserId);
  if (text(query.actorType)) where.actorType = text(query.actorType);
  if (text(query.ip)) where.ip = { contains: text(query.ip) };
  if (text(query.requestId)) where.requestId = text(query.requestId);
  const q = text(query.q);
  if (q) where.OR = [{ action: { contains: q } }, { actorLabel: { contains: q } }, { ip: { contains: q } }];
  return where;
}

// Staff names by id, for rows that point at a staff member.
async function staffNames(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const staff = await prisma.staffUser.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map((staff || []).map((s) => [s.id, s]));
}

async function activity(query, { all = false } = {}) {
  const where = activityWhere(query);
  const { page, pageSize, skip, take } = paging(query);
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...(all ? { take: EXPORT_LIMIT } : { skip, take }) }),
    prisma.activityLog.count({ where })
  ]);
  const names = await staffNames(rows.flatMap((r) => [r.staffUserId, r.actingAsId]));
  return {
    page, pageSize, total,
    rows: rows.map((r) => ({
      ...r,
      staff: r.staffUserId ? names.get(r.staffUserId) || null : null,
      actingAs: r.actingAsId ? names.get(r.actingAsId) || null : null
    }))
  };
}

async function changes(query, { all = false } = {}) {
  const where = changesWhere(query);
  const { page, pageSize, skip, take } = paging(query);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }], ...(all ? { take: EXPORT_LIMIT } : { skip, take }),
      include: { performedBy: { select: { id: true, name: true, email: true } } }
    }),
    prisma.auditLog.count({ where })
  ]);
  const names = await staffNames(rows.map((r) => r.actingAsId));
  return {
    page, pageSize, total,
    rows: rows.map(({ payload, ...r }) => {
      const { changes: changed, comment, actor, ...details } = payload || {};
      return {
        ...r,
        actingAs: r.actingAsId ? names.get(r.actingAsId) || null : null,
        candidateId: actor?.type === 'candidate' ? actor.id : null,
        changes: changed || null,
        comment: comment || null,
        details: Object.keys(details).length ? details : null
      };
    })
  };
}

async function access(query, { all = false } = {}) {
  const where = accessWhere(query);
  const { page, pageSize, skip, take } = paging(query);
  const [rows, total] = await Promise.all([
    prisma.dataAccessLog.findMany({ where, orderBy: [{ at: 'desc' }, { id: 'desc' }], ...(all ? { take: EXPORT_LIMIT } : { skip, take }) }),
    prisma.dataAccessLog.count({ where })
  ]);
  const names = await staffNames(rows.map((r) => r.staffUserId));
  return { page, pageSize, total, rows: rows.map((r) => ({ ...r, staff: r.staffUserId ? names.get(r.staffUserId) || null : null })) };
}

// What the filters offer: everyone with a staff account (current or not),
// and the kinds of record the audit trail holds.
async function meta() {
  const [staff, entityTypes] = await Promise.all([
    prisma.staffUser.findMany({ select: { id: true, name: true, email: true, active: true }, orderBy: { name: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } })
  ]);
  return { staff: staff || [], entityTypes: (entityTypes || []).map((e) => e.entityType) };
}

// An export holds at most this many rows (the newest first) - narrow the
// filters for more.
const EXPORT_LIMIT = 10000;

const who = (r) => r.staff?.name || r.performedBy?.name || r.actorLabel || r.actorType || '';

const EXPORTS = {
  activity: {
    load: activity,
    columns: [
      { header: 'When (UTC)', value: (r) => new Date(r.at).toISOString() },
      { header: 'Who', value: who },
      { header: 'Account type', value: (r) => r.actorType },
      { header: 'Acting for', value: (r) => r.actingAs?.name || '' },
      { header: 'What', value: (r) => r.action },
      { header: 'Outcome', value: (r) => r.outcome },
      { header: 'Status', value: (r) => r.statusCode },
      { header: 'Request', value: (r) => `${r.method} ${r.path}` },
      { header: 'IP address', value: (r) => r.ipAddress },
      { header: 'Browser', value: (r) => r.userAgent },
      { header: 'Details', value: (r) => (r.detail ? JSON.stringify(r.detail) : '') },
      { header: 'Request id', value: (r) => r.requestId }
    ]
  },
  changes: {
    load: changes,
    columns: [
      { header: 'When (UTC)', value: (r) => new Date(r.timestamp).toISOString() },
      { header: 'Who', value: who },
      { header: 'Account type', value: (r) => r.actorType },
      { header: 'Acting for', value: (r) => r.actingAs?.name || '' },
      { header: 'What', value: (r) => r.action },
      { header: 'Record', value: (r) => `${r.entityType} #${r.entityId}` },
      { header: 'Changes', value: (r) => (r.changes ? JSON.stringify(r.changes) : '') },
      { header: 'Comment', value: (r) => r.comment },
      { header: 'IP address', value: (r) => r.ipAddress },
      { header: 'Browser', value: (r) => r.userAgent },
      { header: 'Request', value: (r) => (r.requestMethod ? `${r.requestMethod} ${r.requestPath}` : '') },
      { header: 'Request id', value: (r) => r.requestId }
    ]
  },
  access: {
    load: access,
    columns: [
      { header: 'When (UTC)', value: (r) => new Date(r.at).toISOString() },
      { header: 'Who', value: who },
      { header: 'Account type', value: (r) => r.actorType },
      { header: 'What', value: (r) => r.action },
      { header: 'Vacancy', value: (r) => r.vacancyId },
      { header: 'Application', value: (r) => r.applicationId },
      { header: 'Candidates', value: (r) => (Array.isArray(r.candidateIds) ? r.candidateIds.join(' ') : '') },
      { header: 'IP address', value: (r) => r.ip },
      { header: 'Browser', value: (r) => r.userAgent },
      { header: 'Request id', value: (r) => r.requestId }
    ]
  }
};

module.exports = { activity, changes, access, meta, EXPORTS, EXPORT_LIMIT, activityWhere, changesWhere, accessWhere };
