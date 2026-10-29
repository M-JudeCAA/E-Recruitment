const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../config/db');
const audit = require('./auditService');
const { hasRankOrDelegation } = require('../middleware/auth');
const { AppError } = require('../utils/errorResponse');
const { uploadPath, removeUploads } = require('../utils/uploadFiles');

// Replacing a vacancy's signed requisition copy (the scan EXCO signed,
// Vacancy.requisitionSignedCopyUrl) - a wrong or unreadable scan, say.
// Before the vacancy is approved anyone in HR may replace it (a reason is
// optional); once approved, only a Senior HR Officer or above (own role or
// delegation), with a reason. A vacancy rejected without ever being approved
// is final. Every replacement is kept in RequisitionSignedCopyChange - who,
// in what role, when, why, before or after approval, and both files with
// their SHA-256 - and in the vacancy's audit trail. The old file is kept.

const MIN_REASON_AFTER_APPROVAL = 10;
const MAX_REASON = 2000;
const MAX_NAME_LENGTH = 191;
const EDITABLE_BEFORE_APPROVAL = ['PendingApproval', 'Returned'];

function refused(message, status, code) {
  const err = new AppError(message, status);
  err.code = code;
  return err;
}

const hashOf = async (url) => crypto.createHash('sha256').update(await fs.promises.readFile(uploadPath(url))).digest('hex');

// Whether the viewer may replace it, and under which rule - for the
// vacancy page (no delegation lookup: the API decides).
function rule(vacancy) {
  if (vacancy.approvedAt) return { afterApproval: true, minRole: 'Senior_HR_Officer', reasonRequired: true };
  if (EDITABLE_BEFORE_APPROVAL.includes(vacancy.status)) return { afterApproval: false, minRole: 'HR_Officer', reasonRequired: false };
  return null;
}

/**
 * Replace the signed copy with the uploaded file (multer's, already stored
 * as requisition-signed-<uuid>). The upload is removed again when refused.
 */
async function replace(req, vacancyId, file, reasonText) {
  const newUrl = file ? `/api/files/${file.filename}` : null;
  try {
    if (!file) throw refused('Choose the scan of the signed requisition to upload', 400, 'SIGNED_COPY_REQUIRED');
    const vacancy = await prisma.vacancy.findUnique({
      where: { id: vacancyId },
      select: { id: true, status: true, approvedAt: true, createdById: true, requisitionSignedCopyUrl: true, requisitionSignedCopyName: true, requisitionDetails: true }
    });
    if (!vacancy) throw new AppError('Vacancy not found', 404);
    const how = rule(vacancy);
    if (!how) throw refused('This vacancy was rejected, so its signed copy can no longer be changed', 409, 'VACANCY_REJECTED');
    if (how.afterApproval && !(await hasRankOrDelegation(req, how.minRole))) {
      throw refused('This vacancy has been approved - only a Senior HR Officer or above can replace its signed copy', 403, 'SIGNED_COPY_NEEDS_SENIOR');
    }
    const reason = typeof reasonText === 'string' ? reasonText.trim().slice(0, MAX_REASON) : '';
    if (how.reasonRequired && reason.length < MIN_REASON_AFTER_APPROVAL) {
      throw refused('Say why the signed copy is being replaced (at least 10 characters) - it is kept in the vacancy\'s history', 400, 'REASON_REQUIRED');
    }

    const newHash = await hashOf(newUrl);
    const previousHash = vacancy.requisitionDetails?.signedCopy?.hash || null;
    if (previousHash && previousHash === newHash) {
      throw refused('That is the same file as the current signed copy', 422, 'SAME_FILE');
    }
    const newName = String(file.originalname || file.filename).slice(0, MAX_NAME_LENGTH);
    const now = new Date();

    const change = await prisma.$transaction(async (tx) => {
      // Only over the copy that was read above, so two replacements can't
      // both land with one missing from the history.
      const { count } = await tx.vacancy.updateMany({
        where: { id: vacancyId, requisitionSignedCopyUrl: vacancy.requisitionSignedCopyUrl },
        data: {
          requisitionSignedCopyUrl: newUrl,
          requisitionSignedCopyName: newName,
          requisitionDetails: { ...(vacancy.requisitionDetails || {}), signedCopy: { hash: newHash } }
        }
      });
      if (!count) throw refused('The signed copy was just replaced by someone else - refresh and look again', 409, 'SIGNED_COPY_CHANGED');
      return tx.requisitionSignedCopyChange.create({
        data: {
          vacancyId,
          previousUrl: vacancy.requisitionSignedCopyUrl,
          previousName: vacancy.requisitionSignedCopyName,
          previousHash,
          newUrl, newName, newHash,
          reason: reason || null,
          afterApproval: how.afterApproval,
          changedById: req.user.id,
          changedByRole: req.user.role || null,
          actingAsId: req.actingAsDelegateFor || null,
          changedAt: now
        }
      });
    });

    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action: 'Signed requisition copy replaced', actor: audit.actorFrom(req),
      before: { requisitionSignedCopyName: vacancy.requisitionSignedCopyName }, after: { requisitionSignedCopyName: newName },
      comment: reason || null,
      details: { changeId: change.id, afterApproval: how.afterApproval, previousHash, newHash }
    });
    return change;
  } catch (err) {
    if (newUrl) await removeUploads(newUrl);
    throw err;
  }
}

// Newest first, with the name of whoever replaced it and of the delegator
// whose authority they used.
async function history(vacancyId) {
  const rows = await prisma.requisitionSignedCopyChange.findMany({
    where: { vacancyId }, orderBy: { changedAt: 'desc' },
    select: {
      id: true, previousUrl: true, previousName: true, newUrl: true, newName: true, reason: true, afterApproval: true,
      changedAt: true, changedByRole: true, actingAsId: true, changedBy: { select: { name: true } }
    }
  });
  const delegatorIds = [...new Set((rows || []).map((r) => r.actingAsId).filter(Boolean))];
  const delegators = delegatorIds.length
    ? await prisma.staffUser.findMany({ where: { id: { in: delegatorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = Object.fromEntries((delegators || []).map((d) => [d.id, d.name]));
  return (rows || []).map(({ actingAsId, ...r }) => ({ ...r, actingFor: actingAsId ? nameOf[actingAsId] || null : null }));
}

module.exports = { replace, history, rule, MIN_REASON_AFTER_APPROVAL };
