const multer = require('multer');
const { ALLOWED_MIME, MAX_FILE_SIZE } = require('./uploadConstants');

// Used only for the profile CV-autofill endpoint - the file is read into
// memory to extract text and is never written to disk or referenced by
// any stored URL, unlike upload.js's disk storage (used for the
// application-level cvUrl/coverLetterUrl, which is intentionally kept
// and unaffected by this).
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new Error('Only PDF or Word documents are allowed'));
  }
  cb(null, true);
};

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

module.exports = { uploadMemory };
