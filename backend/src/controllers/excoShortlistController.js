const crypto = require('crypto');
const fs = require('fs');
const prisma = require('../config/db');
const vacancyModel = require('../models/vacancyModel');
const audit = require('../services/auditService');
const meritList = require('../services/meritListService');
const { notifyCandidate } = require('../services/candidateNotificationService');
const hiringManagers = require('../services/hiringManagerService');
const { fileUrl } = require('../middleware/upload');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');
const { computeExperienceYears, highestEducationLevel } = require('../services/screeningService');

// EXCO approves the interview shortlist outside the system: once a
// Principal HR Officer has approved it here, HR prints it (GET, shown by
// ExcoShortlistPanel / the printable sheet), EXCO signs it, and HR attaches
// the signed copy (POST). Attaching it records the approval on every
// application it covers, rejects anyone EXCO struck off, and only then tells
// the candidates - so nobody hears "shortlisted" before EXCO has agreed. No
// first interview can be booked for an application without it
// (interviewController.assertExcoApproved).

const STRUCK_OFF_REASON = 'Not approved for interview by EXCO.';

function parseVacancyId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Invalid vacancy id' }); return null; }
  return id;
}

// Approved for interview here, not yet covered by an EXCO approval, and
// not yet interviewed (rounds booked before this step existed don't need it).
function awaitingWhere(vacancyId) {
  return { vacancyId, status: 'Shortlisted', excoApprovalId: null, interviewRounds: { none: {} } };
}

const AWAITING_SELECT = {
  id: true, rank: true, candidateId: true, committeeRank: true, committeeBand: true, committeeScore: true,
  shortlistApprovedAt: true,
  candidate: {
    select: {
      fullName: true, candidateType: true,
      education: { select: { qualificationLevel: true } },
      workExperience: { select: { startDate: true, endDate: true } }
    }
  }
};

function toRow(a) {
  return {
    applicationId: a.id, rank: a.rank, committeeRank: a.committeeRank, committeeBand: a.committeeBand, committeeScore: a.committeeScore,
    candidateName: a.candidate.fullName, candidateType: a.candidate.candidateType,
    highestEducationLevel: highestEducationLevel(a.candidate.education),
    experienceYears: Math.round(computeExperienceYears(a.candidate.workExperience) * 10) / 10
  };
}

// GET /api/vacancies/:id/exco-shortlist - who is waiting for EXCO, and the
// approvals attached so far.
async function get(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) return;
  const vacancy = await vacancyModel.findById(vacancyId);
  if (!vacancy) return res.status(404).json({ error: 'Vacancy not found' });
  const [awaiting, approvals] = await Promise.all([
    prisma.application.findMany({ where: awaitingWhere(vacancyId), select: AWAITING_SELECT, orderBy: [{ rank: 'asc' }, { id: 'asc' }] }),
    prisma.excoShortlistApproval.findMany({
      where: { vacancyId }, orderBy: { uploadedAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        applications: { select: { id: true, candidate: { select: { fullName: true } } } }
      }
    })
  ]);
  res.json({
    vacancy: {
      id: vacancy.id, jobRef: vacancy.jobRef, title: vacancy.title, positionsRequired: vacancy.positionsRequired,
      deadline: vacancy.deadline, location: vacancy.location, salaryScale: vacancy.salaryScale
    },
    awaiting: awaiting.map(toRow),
    approvals: approvals.map((a) => ({
      id: a.id, documentUrl: a.documentUrl, documentName: a.documentName, excoReference: a.excoReference, approvedOn: a.approvedOn,
      uploadedAt: a.uploadedAt, uploadedBy: a.uploadedBy, struckOff: a.struckOff || [],
      approved: a.applications.map((x) => ({ applicationId: x.id, candidateName: x.candidate.fullName }))
    }))
  });
}

function discard(file) {
  if (file?.path) fs.promises.rm(file.path, { force: true }).catch(() => {});
}

function parseStruckOff(value) {
  if (value == null || value === '') return [];
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(list)) return null;
  const ids = list.map(Number);
  return ids.every((id) => Number.isInteger(id) && id > 0) ? [...new Set(ids)] : null;
}

// POST /api/vacancies/:id/exco-shortlist (multipart: document, excoReference,
// approvedOn, struckOff = JSON array of application ids EXCO did not approve).
async function attach(req, res) {
  const vacancyId = parseVacancyId(req, res);
  if (!vacancyId) { discard(req.file); return; }
  try {
    if (!req.file) return res.status(400).json({ error: 'Attach the shortlist as EXCO signed it', code: 'DOCUMENT_REQUIRED' });
    if (!req.file.size) { discard(req.file); return res.status(422).json({ error: 'The file is empty - scan the signed shortlist again' }); }
    const vacancy = await vacancyModel.findById(vacancyId);
    if (!vacancy) { discard(req.file); return res.status(404).json({ error: 'Vacancy not found' }); }

    const struckIds = parseStruckOff(req.body.struckOff);
    if (!struckIds) { discard(req.file); return res.status(400).json({ error: 'struckOff must be a list of application ids' }); }
    const excoReference = typeof req.body.excoReference === 'string' ? req.body.excoReference.trim().slice(0, 191) || null : null;
    let approvedOn = null;
    if (req.body.approvedOn) {
      approvedOn = new Date(req.body.approvedOn);
      if (Number.isNaN(approvedOn.getTime()) || approvedOn > new Date()) {
        discard(req.file);
        return res.status(400).json({ error: 'The date EXCO approved it must be a real date, not in the future' });
      }
    }

    const awaiting = await prisma.application.findMany({ where: awaitingWhere(vacancyId), select: AWAITING_SELECT });
    if (awaiting.length === 0) {
      discard(req.file);
      return res.status(422).json({ error: 'Nobody on this vacancy is waiting for EXCO approval - approve the interview shortlist first' });
    }
    const awaitingIds = new Set(awaiting.map((a) => a.id));
    const stray = struckIds.filter((id) => !awaitingIds.has(id));
    if (stray.length) {
      discard(req.file);
      return res.status(422).json({ error: 'Only candidates waiting for EXCO approval can be struck off' });
    }
    if (struckIds.length === awaiting.length) {
      discard(req.file);
      return res.status(422).json({ error: 'EXCO struck off everyone - reject the applications instead, or propose a new shortlist' });
    }

    const hash = crypto.createHash('sha256').update(await fs.promises.readFile(req.file.path)).digest('hex');
    const struck = awaiting.filter((a) => struckIds.includes(a.id));
    const approved = awaiting.filter((a) => !struckIds.includes(a.id));
    const now = new Date();

    // All or nothing, and only for applications still waiting - two people
    // attaching at once can't both record an approval for the same people.
    const approval = await prisma.$transaction(async (tx) => {
      const created = await tx.excoShortlistApproval.create({
        data: {
          vacancyId, documentUrl: fileUrl(req.file), documentName: String(req.file.originalname || 'EXCO shortlist').slice(0, 191),
          documentHash: hash, excoReference, approvedOn, uploadedById: req.user.id,
          struckOff: struck.map((a) => ({ applicationId: a.id, candidateName: a.candidate.fullName }))
        }
      });
      const linked = await tx.application.updateMany({
        where: { ...awaitingWhere(vacancyId), id: { in: approved.map((a) => a.id) } }, data: { excoApprovalId: created.id }
      });
      if (linked.count !== approved.length) throw Object.assign(new Error('changed'), { code: 'CHANGED' });
      if (struck.length) {
        const rejected = await tx.application.updateMany({
          where: { ...awaitingWhere(vacancyId), id: { in: struck.map((a) => a.id) } },
          data: {
            status: 'Rejected', rejectedAt: now, rejectedById: req.user.id, rejectionReason: STRUCK_OFF_REASON,
            rank: null, listStatus: null, ...meritList.CLEARED_MERIT, rankVersion: { increment: 1 }
          }
        });
        if (rejected.count !== struck.length) throw Object.assign(new Error('changed'), { code: 'CHANGED' });
      }
      return created;
    }).catch((err) => {
      if (err.code === 'CHANGED') return null;
      throw err;
    });
    if (!approval) {
      discard(req.file);
      return res.status(409).json({ error: 'The shortlist changed while you were attaching this - refresh and try again' });
    }

    const actor = audit.actorFrom(req);
    await audit.record({
      entityType: 'Vacancy', entityId: vacancyId, action: 'EXCO shortlist approval attached', actor,
      after: { approved: approved.length, struckOff: struck.length, excoReference, documentName: approval.documentName },
      fields: ['approved', 'struckOff', 'excoReference', 'documentName'], details: { excoShortlistApprovalId: approval.id }
    });
    await audit.recordMany([
      ...approved.map((a) => ({
        entityType: 'Application', entityId: a.id, action: 'Approved for interview by EXCO', actor,
        details: { excoShortlistApprovalId: approval.id }, comment: excoReference
      })),
      ...struck.map((a) => ({
        entityType: 'Application', entityId: a.id, action: 'Application rejected (struck off by EXCO)', actor,
        before: { status: 'Shortlisted' }, after: { status: 'Rejected' }, fields: ['status'], comment: STRUCK_OFF_REASON
      }))
    ]);

    // Committed - a notification failure must not fail the request.
    for (const a of approved) {
      await notifyCandidate(a.candidateId, 'ApplicationShortlisted',
        `Good news - you've been shortlisted for interview for "${vacancy.title}". We'll be in touch with the date and time.`)
        .catch((err) => console.error(`Shortlisted notice to candidate ${a.candidateId} failed:`, err));
    }
    for (const a of struck) {
      await notifyCandidate(a.candidateId, 'ApplicationRejected',
        `We're sorry to let you know your application for "${vacancy.title}" was not successful this time.`)
        .catch((err) => console.error(`Rejection notice to candidate ${a.candidateId} failed:`, err));
    }
    await hiringManagers.notify(vacancy, 'shortlistApproved', { names: approved.map((a) => a.candidate.fullName) });
    broadcastDashboardEvent('ShortlistApproved', { vacancyId, excoApproved: true });
    res.status(201).json({ id: approval.id, approved: approved.length, struckOff: struck.length });
  } catch (err) {
    discard(req.file);
    throw err;
  }
}

module.exports = { get, attach, STRUCK_OFF_REASON };
