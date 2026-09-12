const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { ALLOWED_MIME, MAX_FILE_SIZE, ALLOWED_IMAGE_MIME, MAX_PHOTO_SIZE } = require('./uploadConstants');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new Error('Only PDF or Word documents are allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

const photoFileFilter = (req, file, cb) => {
  if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
    return cb(new Error('Only JPG, PNG, or WEBP images are allowed'));
  }
  cb(null, true);
};

// Same disk storage/filename randomization as `upload` above - only the
// allowed mime types and size cap differ for a profile photo.
const uploadPhoto = multer({
  storage,
  fileFilter: photoFileFilter,
  limits: { fileSize: MAX_PHOTO_SIZE }
});

// Returns a URL path the frontend can use to reference the uploaded file,
// via the authenticated /api/files route rather than a plain static mount.
function fileUrl(file) {
  return file ? `/api/files/${file.filename}` : null;
}

module.exports = { upload, uploadPhoto, fileUrl };
