const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const staffModel = require('../models/staffModel');
const accessLog = require('../services/accessLogService');
const { previewOf } = require('../utils/documentPreview');
const { allowedOrigins } = require('../config/frontendUrl');
const { loadCurrentCandidate } = require('../middleware/auth');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

function authenticateFromHeaderOrQuery(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Whether the signed-in caller may open this file (answering 403 when not),
// recording a staff member opening a candidate's document. Shared by the
// file itself and its preview.
async function mayOpen(req, res) {
  const { filename } = req.params;
  const relativeUrl = `/api/files/${filename}`;

  if (req.user.type === 'staff') {
    // Any file, for an active account holding an HR role - not for an
    // accounts-only system administrator, nor for a deactivated account
    // still holding an unexpired token.
    const staff = await staffModel.findAuthState(req.user.id);
    if (!staff || !staff.active || !staff.role) {
      res.status(403).json({ error: 'You do not have access to this file' });
      return false;
    }
    // Allowed. Opening a candidate's document is recorded (FR-ATS-081);
    // files that aren't an application's (a requisition, say) aren't
    // candidate data.
    const application = await applicationModel.findByFileUrl(relativeUrl);
    const scoredFor = application ? null : await applicationModel.findByScoreSheetUrl(relativeUrl);
    if (application || scoredFor) {
      const a = application || scoredFor;
      await accessLog.record(req, {
        action: application ? 'Opened a document' : 'Opened an interview score sheet',
        vacancyId: a.vacancyId, applicationId: a.id,
        candidateIds: [a.candidateId], detail: { document: filename }
      });
    }
    return true;
  }
  if (req.user.type === 'candidate') {
    // An erased account, or a session from before a password reset, ends
    // here as everywhere else (requireCandidate).
    if (!(await loadCurrentCandidate(req, res))) return false;
    // A file is either attached to one of the candidate's own
    // applications (cvUrl/coverLetterUrl/a supporting document) or is their own profile photo -
    // either is sufficient.
    const ownsApplicationFile = await applicationModel.findOwnedByCandidate(req.user.id, relativeUrl);
    const ownsPhoto = await candidateModel.findOwnedByCandidate(req.user.id, relativeUrl);
    if (!ownsApplicationFile && !ownsPhoto) {
      res.status(403).json({ error: 'You do not have access to this file' });
      return false;
    }
    return true;
  }
  res.status(403).json({ error: 'Not authorized' });
  return false;
}

// GET /api/files/:filename[?download=1&name=] - the file: shown in the
// browser where it can be (the in-app viewer), downloaded with download=1.
async function serve(req, res) {
  if (!(await mayOpen(req, res))) return;
  sendUploadedFile(res, req.params.filename, downloadOptions(req));
}

// GET /api/files/:filename/preview - what the in-app viewer shows
// (utils/documentPreview.js).
async function preview(req, res) {
  if (!(await mayOpen(req, res))) return;
  await sendPreview(res, req.params.filename);
}

// Types a browser may show in the tab. Anything else - Word files, and any
// file stored under another extension before uploads were named by their
// type - is only ever downloaded, never rendered: a file a candidate
// uploaded must not run as a page on this site, where staff sessions live.
const INLINE_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

// The stored file's path, or null (after answering 404) when the name isn't
// a plain file in the upload folder.
function storedFile(res, filename) {
  const filePath = path.join(uploadDir, filename);
  if (path.basename(filename) !== filename || !filePath.startsWith(uploadDir + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return null;
  }
  return filePath;
}

// The name a download is saved under: the name the document goes by (as the
// uploader gave it), cut down to safe characters, always with the stored
// file's own extension.
function downloadName(name, filename) {
  const ext = path.extname(filename).toLowerCase();
  const base = String(name || '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9 ._()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || path.basename(filename, ext)}${ext}`;
}

const downloadOptions = (req) => ({ download: req.query.download === '1', name: req.query.name });

// Sends one uploaded file once the caller's access has been checked -
// shared with the shortlisting committee's link (shortlistPanelController).
// download: as a download (the viewer's Download button), saved as `name`.
function sendUploadedFile(res, filename, { download = false, name } = {}) {
  const filePath = storedFile(res, filename);
  if (!filePath) return undefined;
  const inlineType = INLINE_TYPES[path.extname(filename).toLowerCase()];
  res.set('X-Content-Type-Options', 'nosniff');
  if (inlineType && !download) {
    res.type(inlineType);
    // Only who may frame it - the API's default-src 'none' (app.js) could
    // stop a browser's built-in PDF viewer from drawing the file.
    res.set('Content-Security-Policy', `frame-ancestors 'self' ${allowedOrigins.join(' ')}`.trim());
    return res.sendFile(filePath);
  }
  res.set('Content-Type', 'application/octet-stream');
  return res.download(filePath, downloadName(name, filename));
}

// The viewer's content for one file whose access has been checked.
async function sendPreview(res, filename) {
  const filePath = storedFile(res, filename);
  if (!filePath) return undefined;
  return res.json(await previewOf(filePath));
}

module.exports = { authenticateFromHeaderOrQuery, serve, preview, sendUploadedFile, sendPreview, downloadOptions, downloadName };
