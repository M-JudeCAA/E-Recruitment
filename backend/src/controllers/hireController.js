const fs = require('fs');
const prisma = require('../config/db');
const hires = require('../services/hireService');
const handoff = require('../services/hrisHandoffService');
const audit = require('../services/auditService');
const hiringManagers = require('../services/hiringManagerService');
const conflictOfInterest = require('../services/conflictOfInterestService');
const { fileUrl } = require('../middleware/upload');
const { sendError } = require('../utils/errorResponse');
const { broadcastDashboardEvent } = require('../realtime/dashboardSocket');

// "Mark as Hired" (hireService) and the onboarding case it opens, handed to
// the HRIS by hrisHandoffService. Principal HR Officer+.

// What staff see of a case - the package itself only through /package.
function view(hire) {
  if (!hire) return null;
  const { package: pkg, ...rest } = hire;
  return { ...rest, hrisConfigured: handoff.configured() };
}

// POST /api/applications/offers/:offerId/hire - multipart `signedInstrument`.
async function markHired(req, res) {
  const offerId = Number(req.params.offerId);
  const signed = req.file ? { url: fileUrl(req.file), name: String(req.file.originalname || req.file.filename).slice(0, 200) } : null;
  let result;
  try {
    result = await hires.markHired(offerId, signed, req.user.id);
  } catch (err) {
    if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    if (err.code === 'SIGNED_INSTRUMENT_REQUIRED') return res.status(400).json({ error: err.message, code: err.code });
    return sendError(res, err, 422);
  }
  if (!result.created) {
    // Already hired - nothing new is made (BR-ATS-11); the upload isn't needed.
    if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    return res.json({ ...view(result.hire), alreadyHired: true });
  }
  let hire = result.hire;
  await audit.record({
    entityType: 'Offer', entityId: offerId, action: 'Marked as hired', actor: audit.actorFrom(req),
    details: { caseRef: hire.caseRef, signedInstrument: hire.signedInstrumentName }
  });
  await audit.record({
    entityType: 'Application', entityId: hire.applicationId, action: 'Marked as hired', actor: audit.actorFrom(req), details: { caseRef: hire.caseRef }
  });
  if (handoff.configured()) hire = await handoff.send(hire.id);
  await hiringManagers.notify(hire.vacancyId, 'hired', { candidateName: hire.package?.person?.fullName, startDate: hire.startDate, caseRef: hire.caseRef });
  broadcastDashboardEvent('ApplicationUpdated', { vacancyId: hire.vacancyId });
  res.status(201).json(view(hire));
}

async function loadHire(req, res) {
  const hire = await prisma.hire.findUnique({
    where: { offerId: Number(req.params.offerId) }, include: { hiredBy: { select: { id: true, name: true } } }
  });
  if (!hire) { res.status(404).json({ error: 'This candidate has not been marked hired' }); return null; }
  return hire;
}

// GET .../hire - the case.
async function get(req, res) {
  const hire = await loadHire(req, res);
  if (hire) res.json(view(hire));
}

// GET .../hire/package - what was (or would be) sent to the HRIS, as a file
// HR can pass on by hand while no HRIS link is set up.
async function downloadPackage(req, res) {
  const hire = await loadHire(req, res);
  if (!hire) return;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="onboarding-${hire.caseRef.replace(/\//g, '-')}.json"`);
  res.send(JSON.stringify({ caseRef: hire.caseRef, hiredAt: hire.hiredAt, ...hire.package }, null, 2));
}

// POST .../hire/retry - send to the HRIS again now (a Failed case too).
async function retry(req, res) {
  const hire = await loadHire(req, res);
  if (!hire) return;
  if (!handoff.configured()) return res.status(422).json({ error: 'No HRIS connection is set up - download the package and pass it on by hand', code: 'HRIS_NOT_CONFIGURED' });
  if (hire.handoffStatus === 'Sent') return res.status(409).json({ error: 'The HRIS already has this case' });
  if (hire.handoffStatus === 'Failed') await prisma.hire.update({ where: { id: hire.id }, data: { handoffStatus: 'Pending', handoffAttempts: 0 } });
  const updated = await handoff.send(hire.id);
  await audit.record({ entityType: 'Offer', entityId: hire.offerId, action: 'HRIS handoff retried', actor: audit.actorFrom(req), details: { caseRef: hire.caseRef, result: updated.handoffStatus } });
  res.json(view({ ...updated, hiredBy: hire.hiredBy }));
}

// GET /api/applications/hires - every onboarding case (newest first), for
// the Offers tracker, leaving out vacancies the requester applied for.
async function list(req, res) {
  const excluded = await conflictOfInterest.conflictedVacancyIds(req);
  const rows = await prisma.hire.findMany({
    where: excluded.length ? { vacancyId: { notIn: excluded } } : {},
    orderBy: { hiredAt: 'desc' }, take: 500,
    include: {
      hiredBy: { select: { id: true, name: true } },
      application: { select: { candidate: { select: { fullName: true } }, vacancy: { select: { jobRef: true, title: true } } } }
    }
  });
  res.json(rows.map(({ application, ...h }) => ({ ...view(h), candidateName: application.candidate.fullName, vacancy: application.vacancy })));
}

module.exports = { markHired, get, downloadPackage, retry, list };
