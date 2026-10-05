const prisma = require('../config/db');
const { DEFAULTS } = require('../config/documentTemplates');
const { sanitizeJobDescription } = require('../utils/htmlSanitizer');
const { escapeHtml } = require('../utils/interviewFormat');
const { AppError } = require('../utils/errorResponse');

// Document templates (config/documentTemplates.js): the default wording in
// code, HR's edits in DocumentTemplate rows. render() fills a template's
// placeholders from a context built by documentController - {{name}} gets
// an escaped value, a `block` placeholder (a table/list the server built)
// is inserted as it is, and anything not listed for the template is left
// visible so a mistyped placeholder shows up in the preview.

const MAX_BODY = 60000;
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

function definition(key) {
  const def = DEFAULTS[key];
  if (!def) throw new AppError('No such template', 404);
  return def;
}

async function get(key) {
  const def = definition(key);
  const row = await prisma.documentTemplate.findUnique({
    where: { key }, include: { updatedBy: { select: { id: true, name: true } } }
  });
  return {
    key, name: def.name, description: def.description, placeholders: def.placeholders,
    body: row ? row.body : def.body, defaultBody: def.body, edited: Boolean(row),
    updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null
  };
}

async function list() {
  const rows = await prisma.documentTemplate.findMany({ include: { updatedBy: { select: { id: true, name: true } } } });
  return Object.entries(DEFAULTS).map(([key, def]) => {
    const row = rows.find((r) => r.key === key);
    return { key, name: def.name, description: def.description, edited: Boolean(row), updatedAt: row?.updatedAt || null, updatedBy: row?.updatedBy || null };
  });
}

// Saves HR's version. The body is sanitised the same way as job adverts
// (formatting and tables kept, scripts and the like dropped); placeholders
// are plain text and survive it.
async function save(key, body, staffId) {
  definition(key);
  if (typeof body !== 'string' || !body.trim()) throw new AppError('The template is empty', 400);
  if (body.length > MAX_BODY) throw new AppError('The template is too long', 400);
  const clean = sanitizeJobDescription(body);
  const before = await prisma.documentTemplate.findUnique({ where: { key } });
  await prisma.documentTemplate.upsert({
    where: { key }, create: { key, body: clean, updatedById: staffId }, update: { body: clean, updatedById: staffId }
  });
  return { before: before?.body ?? DEFAULTS[key].body, after: clean };
}

async function reset(key) {
  definition(key);
  await prisma.documentTemplate.deleteMany({ where: { key } });
}

// Placeholders a body uses that the template doesn't offer.
function unknownPlaceholders(key, body) {
  const known = new Set(definition(key).placeholders.map((p) => p.key));
  return [...new Set([...String(body).matchAll(PLACEHOLDER_RE)].map((m) => m[1]))].filter((k) => !known.has(k));
}

function fill(key, body, context) {
  const placeholders = new Map(definition(key).placeholders.map((p) => [p.key, p]));
  return body.replace(PLACEHOLDER_RE, (whole, name) => {
    const p = placeholders.get(name);
    if (!p) return whole;
    const value = context[name];
    if (p.block) return value || '';
    return escapeHtml(value == null ? '' : String(value));
  });
}

/** { title, html } for a template filled with `context`. */
async function render(key, context, title) {
  const template = await get(key);
  return { title: title || template.name, html: fill(key, template.body, context) };
}

module.exports = { get, list, save, reset, render, fill, unknownPlaceholders, DEFAULTS };
