const prisma = require('../config/db');
const documents = require('../services/documentService');
const templates = require('../services/templateService');
const audit = require('../services/auditService');
const accessLog = require('../services/accessLogService');
const { sendError } = require('../utils/errorResponse');

// The printed documents (offer letter, appointing instrument, interview
// invitation, regret letter, EXCO shortlist) and their templates. Each
// document answers { title, html } for the browser to print or save as PDF
// (frontend utils/printDocument.js); producing one is recorded in the access
// log, like opening a candidate's file.

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    sendError(res, err);
  }
};

function documentHandler(param, make, action) {
  return wrap(async (req, res) => {
    const id = parseId(req.params[param]);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const doc = await make(id);
    await accessLog.record(req, { action, vacancyId: doc.vacancyId, applicationId: doc.applicationId, candidateIds: doc.candidateIds });
    res.json({ title: doc.title, html: doc.html });
  });
}

// The candidate's own offer letter, once the offer is issued. Opening it
// counts as viewing the offer.
const candidateOfferLetter = wrap(async (req, res) => {
  const offerId = parseId(req.params.offerId);
  if (!offerId) return res.status(400).json({ error: 'Invalid id' });
  const offer = await prisma.offer.findUnique({ where: { id: offerId }, include: { application: true } });
  if (!offer || offer.application.candidateId !== req.user.id || !offer.approvedDate) return res.status(404).json({ error: 'Offer not found' });
  const doc = await documents.offerLetter(offerId);
  if (!offer.viewedAt) await prisma.offer.updateMany({ where: { id: offerId, viewedAt: null }, data: { viewedAt: new Date() } });
  res.json({ title: doc.title, html: doc.html });
});

const listTemplates = wrap(async (req, res) => res.json(await templates.list()));
const getTemplate = wrap(async (req, res) => res.json(await templates.get(req.params.key)));

const previewTemplate = wrap(async (req, res) => {
  await templates.get(req.params.key); // 404 for an unknown key
  res.json(documents.preview(req.params.key, String(req.body?.body || '')));
});

// PUT - HR Manager+ saves their own wording; DELETE puts the default back.
const saveTemplate = wrap(async (req, res) => {
  const { key } = req.params;
  const unknown = templates.unknownPlaceholders(key, String(req.body?.body || ''));
  if (unknown.length) {
    return res.status(400).json({ error: `These placeholders don't exist for this document: ${unknown.map((u) => `{{${u}}}`).join(', ')}`, code: 'UNKNOWN_PLACEHOLDERS', unknown });
  }
  const { before, after } = await templates.save(key, req.body?.body, req.user.id);
  await audit.record({
    entityType: 'DocumentTemplate', entityId: 0, action: `Document template edited: ${templates.DEFAULTS[key].name}`, actor: audit.actorFrom(req),
    before: { body: before }, after: { body: after }, fields: ['body'], details: { key }
  });
  res.json(await templates.get(key));
});

const resetTemplate = wrap(async (req, res) => {
  const { key } = req.params;
  await templates.reset(key);
  await audit.record({
    entityType: 'DocumentTemplate', entityId: 0, action: `Document template reset to the default: ${templates.DEFAULTS[key].name}`,
    actor: audit.actorFrom(req), details: { key }
  });
  res.json(await templates.get(key));
});

module.exports = {
  offerLetter: documentHandler('offerId', documents.offerLetter, 'Printed an offer letter'),
  appointmentInstrument: documentHandler('offerId', documents.appointmentInstrument, 'Printed an appointing instrument'),
  interviewInvitation: documentHandler('interviewId', documents.interviewInvitation, 'Printed an interview invitation letter'),
  regretLetter: documentHandler('applicationId', documents.regretLetter, 'Printed a regret letter'),
  excoShortlist: documentHandler('id', documents.excoShortlist, 'Printed the interview shortlist for EXCO'),
  candidateOfferLetter, listTemplates, getTemplate, previewTemplate, saveTemplate, resetTemplate
};
