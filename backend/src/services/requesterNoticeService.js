const prisma = require('../config/db');
const { notify } = require('./notificationService');
const { vacancyTab } = require('../utils/notificationLinks');

// Telling whoever asked for an approval that it was given, by email and
// in-app (ApprovalGiven, with a link to where it now stands). Returns and
// rejections have their own notices (VacancyReturned, OfferReturned, ...).
// Never whoever made the decision, never an inactive account, once per
// person. Never throws - the decision stands even when the notice can't go.

async function tell(requesterIds, { taskId, message, link, subject, excludeIds = [] }) {
  try {
    const excluded = new Set(excludeIds.filter(Boolean));
    const ids = [...new Set(requesterIds.filter(Boolean))].filter((id) => !excluded.has(id));
    if (!ids.length) return;
    const active = await prisma.staffUser.findMany({ where: { id: { in: ids }, active: true }, select: { id: true } });
    for (const { id } of active || []) await notify(id, 'ApprovalGiven', taskId, message, { link, subject });
  } catch (err) {
    console.error(`Failed to tell requesters about approval ${subject || ''} ${taskId}:`, err);
  }
}

const vacancyName = (v) => [v?.jobRef, v?.title].filter(Boolean).join(' ');
const by = (req) => req.user?.name || 'the approver';

function vacancyApproved(vacancy, req) {
  return tell([vacancy.createdById], {
    taskId: vacancy.id,
    link: vacancyTab(vacancy.id),
    subject: 'Approved: vacancy',
    message: `Vacancy ${vacancyName(vacancy)} was approved by ${by(req)} and is now advertised.`,
    excludeIds: [req.user?.id]
  });
}

// offer: with application.vacancy and application.candidate (or a name).
function offerChecked(offer, req, candidateName) {
  return tell([offer.recommendedById], {
    taskId: offer.id,
    link: vacancyTab(offer.application?.vacancyId, 'merit'),
    subject: 'Checked: offer',
    message: `The offer to ${candidateName || 'the candidate'} for ${vacancyName(offer.application?.vacancy)} was checked by ${by(req)} and forwarded to the Directors for approval.`,
    excludeIds: [req.user?.id]
  });
}

function offerApproved(offer, req, candidateName) {
  return tell([offer.recommendedById, offer.checkedById], {
    taskId: offer.id,
    link: vacancyTab(offer.application?.vacancyId, 'merit'),
    subject: 'Approved: offer',
    message: `The offer to ${candidateName || 'the candidate'} for ${vacancyName(offer.application?.vacancy)} was approved by ${by(req)} and issued to the candidate.`,
    excludeIds: [req.user?.id]
  });
}

function shortlistApproved(vacancy, proposerIds, count, req) {
  return tell(proposerIds, {
    taskId: vacancy.id,
    link: vacancyTab(vacancy.id, 'interviews'),
    subject: 'Approved: interview shortlist',
    message: `The interview shortlist for ${vacancyName(vacancy)} (${count} candidate${count === 1 ? '' : 's'}) was approved by ${by(req)}. Print it for EXCO and attach the signed copy before scheduling interviews.`,
    excludeIds: [req.user?.id]
  });
}

function meritListApproved(vacancy, proposerIds, req) {
  return tell(proposerIds, {
    taskId: vacancy.id,
    link: vacancyTab(vacancy.id, 'merit'),
    subject: 'Approved: merit list',
    message: `The merit list for ${vacancyName(vacancy)} was approved by ${by(req)}. Offers can now be drafted for the Primary candidates.`,
    excludeIds: [req.user?.id]
  });
}

const ORG_PAGES = { Directorate: 'directorates', Department: 'departments', Position: 'positions' };
const ORG_WORDS = { Directorate: 'directorate', Department: 'department', Position: 'title' };

function orgItemApproved(entityType, row, req) {
  return tell([row.createdById], {
    taskId: row.id,
    link: `/hr/organisation/${ORG_PAGES[entityType]}?open=${row.id}`,
    subject: `Approved: ${ORG_WORDS[entityType]}`,
    message: `The ${ORG_WORDS[entityType]} ${row.name}${row.code ? ` (${row.code})` : ''} was approved by ${by(req)} and can now be used.`,
    excludeIds: [req.user?.id]
  });
}

function orgImportApproved(record, counts, req) {
  return tell([record.createdById], {
    taskId: record.id,
    link: '/hr/organisation',
    subject: 'Approved: organisation import',
    message: `Your import ${record.fileName} was approved by ${by(req)}: ${counts.directorates} directorate(s), ${counts.departments} department(s) and ${counts.positions} title(s) can now be used.`,
    excludeIds: [req.user?.id]
  });
}

module.exports = { tell, vacancyApproved, offerChecked, offerApproved, shortlistApproved, meritListApproved, orgItemApproved, orgImportApproved };
