const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');
const staffModel = require('../models/staffModel');
const accessLog = require('../services/accessLogService');

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

async function serve(req, res) {
  const { filename } = req.params;
  const relativeUrl = `/api/files/${filename}`;

  if (req.user.type === 'staff') {
    // Any file, for an active account holding an HR role - not for an
    // accounts-only system administrator, nor for a deactivated account
    // still holding an unexpired token.
    const staff = await staffModel.findAuthState(req.user.id);
    if (!staff || !staff.active || !staff.role) return res.status(403).json({ error: 'You do not have access to this file' });
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
  } else if (req.user.type === 'candidate') {
    // A file is either attached to one of the candidate's own
    // applications (cvUrl/coverLetterUrl/a supporting document) or is their own profile photo -
    // either is sufficient.
    const ownsApplicationFile = await applicationModel.findOwnedByCandidate(req.user.id, relativeUrl);
    const ownsPhoto = await candidateModel.findOwnedByCandidate(req.user.id, relativeUrl);
    if (!ownsApplicationFile && !ownsPhoto) return res.status(403).json({ error: 'You do not have access to this file' });
  } else {
    return res.status(403).json({ error: 'Not authorized' });
  }

  sendUploadedFile(res, filename);
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

// Streams one uploaded file once the caller's access has been checked -
// shared with the shortlisting committee's link (shortlistPanelController).
function sendUploadedFile(res, filename) {
  const filePath = path.join(uploadDir, filename);
  if (path.basename(filename) !== filename || !filePath.startsWith(uploadDir + path.sep) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  const inlineType = INLINE_TYPES[path.extname(filename).toLowerCase()];
  res.set('X-Content-Type-Options', 'nosniff');
  if (inlineType) {
    res.type(inlineType);
    return res.sendFile(filePath);
  }
  res.set('Content-Type', 'application/octet-stream');
  return res.download(filePath, filename);
}

module.exports = { authenticateFromHeaderOrQuery, serve, sendUploadedFile };
