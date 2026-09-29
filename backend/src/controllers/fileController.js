const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const applicationModel = require('../models/applicationModel');
const candidateModel = require('../models/candidateModel');

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
    // allowed
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

// Streams one uploaded file once the caller's access has been checked -
// shared with the shortlisting committee's link (shortlistPanelController).
function sendUploadedFile(res, filename) {
  const filePath = path.join(uploadDir, filename);
  if (!filePath.startsWith(uploadDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  return res.sendFile(filePath);
}

module.exports = { authenticateFromHeaderOrQuery, serve, sendUploadedFile };
