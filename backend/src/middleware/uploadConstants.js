// Shared between upload.js (disk storage, e.g. application CVs/cover
// letters) and uploadMemory.js (in-memory, e.g. profile CV autofill) so
// the two never drift apart on what's accepted.
const ALLOWED_MIME = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Profile photo - a separate, image-only allowlist and a much smaller cap
// than the document limit above (an avatar has no business being 10MB).
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_SIZE = 3 * 1024 * 1024; // 3MB

module.exports = { ALLOWED_MIME, MAX_FILE_SIZE, ALLOWED_IMAGE_MIME, MAX_PHOTO_SIZE };
