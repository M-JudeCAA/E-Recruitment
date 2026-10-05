const { Prisma } = require('@prisma/client');
const vacancyDraftModel = require('../models/vacancyDraftModel');
const { FILENAME_RE, SIGNED_COPY_FILENAME_RE } = require('../services/requisitionService');

// Drafts of a vacancy being written on the New Listing page, saved by hand
// ("Save draft") or automatically as HR types. Private to whoever writes
// them; creating the vacancy deletes the draft (vacancyController.create,
// via draftId). A draft is only a convenience - it is never validated as a
// vacancy, and creating one still goes through every check in create().

const MAX_TITLE_LENGTH = 191;
const MAX_DRAFT_BYTES = 90 * 1024; // within express.json's 100kb body limit

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// { data } for a valid body, or { error }.
function draftData(body) {
  const { form, requisition, signedCopy } = body || {};
  if (!form || typeof form !== 'object' || Array.isArray(form)) return { error: 'form must be an object' };
  if (requisition != null && (typeof requisition !== 'object' || Array.isArray(requisition))) return { error: 'requisition must be an object' };
  const filename = requisition?.document?.filename || null;
  if (filename && !FILENAME_RE.test(filename)) return { error: 'The draft refers to an upload that is not a requisition' };
  if (signedCopy != null && (typeof signedCopy !== 'object' || Array.isArray(signedCopy))) return { error: 'signedCopy must be an object' };
  const signedFilename = signedCopy?.filename || null;
  if (signedFilename && !SIGNED_COPY_FILENAME_RE.test(signedFilename)) return { error: 'The draft refers to an upload that is not a signed requisition' };
  if (Buffer.byteLength(JSON.stringify({ form, requisition, signedCopy })) > MAX_DRAFT_BYTES) return { error: 'This draft is too large to save' };
  const jobTitle = requisition?.fields?.jobTitle?.value;
  return {
    data: {
      form,
      requisition: requisition || undefined,
      requisitionFilename: filename,
      // null clears a signed copy the draft no longer has
      signedCopy: signedCopy || Prisma.DbNull,
      signedCopyFilename: signedFilename,
      title: typeof jobTitle === 'string' ? jobTitle.slice(0, MAX_TITLE_LENGTH) : null
    }
  };
}

// GET /api/vacancy-drafts - the caller's own drafts, most recent first.
async function list(req, res) {
  res.json(await vacancyDraftModel.listMine(req.user.id));
}

async function get(req, res) {
  const id = parseId(req.params.id);
  const draft = id && await vacancyDraftModel.findMine(id, req.user.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json(draft);
}

async function create(req, res) {
  const { data, error } = draftData(req.body);
  if (error) return res.status(400).json({ error });
  const draft = await vacancyDraftModel.create({ ...data, createdById: req.user.id });
  res.status(201).json(draft);
}

// PUT /api/vacancy-drafts/:id - { form, requisition, baseUpdatedAt }. The
// save is refused (409 DRAFT_CHANGED) if the draft was saved elsewhere
// since baseUpdatedAt, rather than overwriting that work.
async function update(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(404).json({ error: 'Draft not found' });
  const base = new Date(req.body?.baseUpdatedAt);
  if (Number.isNaN(base.getTime())) return res.status(400).json({ error: 'baseUpdatedAt is required' });
  const { data, error } = draftData(req.body);
  if (error) return res.status(400).json({ error });

  const result = await vacancyDraftModel.updateIfUnchanged(id, req.user.id, base, data);
  if (result.count === 0) {
    if (!(await vacancyDraftModel.findMine(id, req.user.id))) return res.status(404).json({ error: 'Draft not found' });
    return res.status(409).json({
      error: 'This draft was saved from another window since you opened it. Reload it to see the latest version.',
      code: 'DRAFT_CHANGED'
    });
  }
  const saved = await vacancyDraftModel.findMine(id, req.user.id);
  res.json({ id: saved.id, title: saved.title, updatedAt: saved.updatedAt });
}

async function remove(req, res) {
  const id = parseId(req.params.id);
  const result = id ? await vacancyDraftModel.removeMine(id, req.user.id) : { count: 0 };
  if (result.count === 0) return res.status(404).json({ error: 'Draft not found' });
  res.status(204).end();
}

module.exports = { list, get, create, update, remove };
