// Shared between upload.js (disk storage, e.g. application CVs/cover
// letters) and uploadMemory.js (in-memory, e.g. profile CV autofill) so
// the two never drift apart on what's accepted.
const ALLOWED_MIME = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

module.exports = { ALLOWED_MIME, MAX_FILE_SIZE };
