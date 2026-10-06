const prisma = require('../config/db');
const purge = require('../services/candidatePurgeService');
const audit = require('../services/auditService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const { notifyAllWithRole } = require('../services/notificationService');
const { sendMail } = require('../utils/mailer');
const { escapeHtml } = require('../utils/interviewFormat');

// Data-subject rights (FR-ATS-079/080). A candidate can download a copy of
// their data at any time, and ask for it to be erased; a Manager+ completes
// the request (the data is purged at once - candidatePurgeService) or refuses
// it with a reason. The purge log lists every erasure, by request or by the
// retention schedule.

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/candidates/me/data-export - everything we hold about the
// candidate themself, as JSON. HR's own working information (rankings,
// committee ratings, notes, offers not yet issued) isn't theirs to see here
// any more than in My Applications.
async function exportMine(req, res) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: req.user.id },
    include: {
      education: true, workExperience: true, examGrades: true, certificates: true, internalProfile: true,
      applications: {
        select: {
          id: true, status: true, createdAt: true, submittedDate: true, rejectedAt: true, withdrawalReason: true,
          desiredSalary: true, openToRelocate: true, earliestStartDate: true, whyThisRole: true,
          desirableResponses: true, disqualifyingResponses: true, referees: true, consentGivenAt: true, consentNoticeVersion: true,
          vacancy: { select: { jobRef: true, title: true } },
          documents: { select: { category: true, label: true, originalName: true, uploadedAt: true } },
          interviewRounds: { select: { roundNumber: true, scheduledDate: true, mode: true, location: true, status: true, candidateResponse: true } },
          offer: { select: { status: true, approvedDate: true, salaryAmount: true, salaryCurrency: true, salaryPeriod: true, startDate: true, decidedAt: true } }
        }
      },
      dataRequests: { select: { id: true, status: true, createdAt: true, decidedAt: true, decisionReason: true } }
    }
  });
  if (!candidate) return res.status(404).json({ error: 'Account not found' });
  const { passwordHash, entraObjectId, ...rest } = candidate;
  rest.applications = rest.applications.map((a) => ({ ...a, offer: a.offer?.approvedDate ? a.offer : null }));
  res.setHeader('Content-Disposition', 'attachment; filename="my-ucaa-recruitment-data.json"');
  res.json({ exportedAt: new Date().toISOString(), ...rest });
}

async function listMine(req, res) {
  res.json(await prisma.dataSubjectRequest.findMany({
    where: { candidateId: req.user.id }, orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, reason: true, createdAt: true, decidedAt: true, decisionReason: true }
  }));
}

// POST /api/candidates/me/data-requests { reason? } - ask for erasure.
async function requestErasure(req, res) {
  const pending = await prisma.dataSubjectRequest.findFirst({ where: { candidateId: req.user.id, status: 'Pending' } });
  if (pending) return res.status(409).json({ error: 'You already have a request waiting to be dealt with' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 2000) || null : null;
  const request = await prisma.dataSubjectRequest.create({ data: { candidateId: req.user.id, reason } });
  await audit.record({
    entityType: 'Candidate', entityId: req.user.id, action: 'Data erasure requested', actor: audit.actorFrom(req), comment: reason,
    details: { requestId: request.id }
  });
  try {
    await notifyAllWithRole('Manager', 'DataErasureRequested', request.id,
      `A candidate (account #${req.user.id}) asked for their personal data to be erased. Review the request under Settings & data.`);
  } catch (err) {
    console.error('Erasure request notice failed:', err);
  }
  res.status(201).json(request);
}

// GET /api/data-protection/requests?status= - Manager+.
async function listRequests(req, res) {
  const status = ['Pending', 'Completed', 'Refused'].includes(req.query.status) ? req.query.status : undefined;
  const requests = await prisma.dataSubjectRequest.findMany({
    where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200,
    include: {
      decidedBy: { select: { id: true, name: true } },
      candidate: {
        select: {
          id: true, fullName: true, email: true, purgedAt: true,
          applications: { select: { id: true, status: true, vacancy: { select: { jobRef: true, title: true } }, offer: { select: { status: true } } } }
        }
      }
    }
  });
  res.json(requests.map((r) => ({
    ...r,
    // Why it can't be completed right now, if it can't.
    blocker: r.status === 'Pending' ? purge.blockerFor(r.candidate) : null
  })));
}

async function loadPending(req, res) {
  const id = parseId(req.params.id);
  const request = id && await prisma.dataSubjectRequest.findUnique({ where: { id }, include: { candidate: true } });
  if (!request) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (request.status !== 'Pending') { res.status(409).json({ error: 'This request has already been dealt with' }); return null; }
  return request;
}

// PATCH /api/data-protection/requests/:id/complete - erase now. The
// confirmation goes by email, captured before the address is erased.
async function complete(req, res) {
  const request = await loadPending(req, res);
  if (!request) return;
  const { email, fullName } = request.candidate;
  const result = await purge.purgeCandidate(request.candidateId, { reason: 'ErasureRequest', requestId: request.id, performedById: req.user.id });
  if (result.refused) return res.status(409).json({ error: result.refused });
  await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'Completed', decidedById: req.user.id, decidedAt: new Date() } });
  await audit.record({
    entityType: 'Candidate', entityId: request.candidateId, action: 'Candidate data erased (request)', actor: audit.actorFrom(req),
    details: { requestId: request.id, removed: result.removed }
  });
  await sendMail({
    to: email, subject: 'Your personal data has been erased - UCAA e-Recruitment',
    html: `<p>Dear ${escapeHtml(fullName)},</p><p>As you asked, the Uganda Civil Aviation Authority has erased the personal data in your e-Recruitment account, `
      + 'including your profile, documents and applications\' details. Your account has been closed.</p>'
      + '<p>A record that an application was made, without anything that identifies you, is kept for our recruitment statistics.</p><p>UCAA Human Resources</p>'
  });
  res.json({ status: 'Completed', removed: result.removed });
}

// PATCH /api/data-protection/requests/:id/refuse { reason } - the candidate
// is told why.
async function refuse(req, res) {
  const request = await loadPending(req, res);
  if (!request) return;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
  if (reason.length < 10) return res.status(400).json({ error: 'Give the reason - the candidate is told it' });
  await prisma.dataSubjectRequest.update({ where: { id: request.id }, data: { status: 'Refused', decidedById: req.user.id, decidedAt: new Date(), decisionReason: reason } });
  await audit.record({
    entityType: 'Candidate', entityId: request.candidateId, action: 'Data erasure request refused', actor: audit.actorFrom(req),
    comment: reason, details: { requestId: request.id }
  });
  try {
    await notifyCandidate(request.candidateId, 'DataRequestRefused', `Your request to erase your data was not carried out: ${reason}`);
  } catch (err) {
    console.error('Refusal notice failed:', err);
  }
  res.json({ status: 'Refused' });
}

// GET /api/data-protection/purges - the purge log, newest first.
async function listPurges(req, res) {
  res.json(await prisma.dataPurgeLog.findMany({ orderBy: { at: 'desc' }, take: 200 }));
}

module.exports = { exportMine, listMine, requestErasure, listRequests, complete, refuse, listPurges };
