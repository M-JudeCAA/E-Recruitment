const multer = require('multer');
const { ALLOWED_MIME, MAX_FILE_SIZE } = require('./uploadConstants');
const { AppError } = require('../utils/errorResponse');

// Used only for the profile CV-autofill endpoint - the file is read into
// memory to extract text and is never written to disk or referenced by
// any stored URL, unlike upload.js's disk storage (used for the
// application-level cvUrl/coverLetterUrl, which is intentionally kept
// and unaffected by this).
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new AppError('Only PDF or Word documents are allowed', 400));
  }
  cb(null, true);
};

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

// Org-structure import (orgImportService.js): an Excel workbook or CSV,
// read in memory and never stored. Browsers report CSV under several types,
// so it's checked by extension.
const SPREADSHEET_MAX_SIZE = 2 * 1024 * 1024;
const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!/\.(xlsx|csv)$/i.test(file.originalname || '')) {
      return cb(new AppError('Upload an Excel workbook (.xlsx) or a CSV file (.csv)', 400));
    }
    cb(null, true);
  },
  limits: { fileSize: SPREADSHEET_MAX_SIZE }
});

module.exports = { uploadMemory, uploadSpreadsheet };
