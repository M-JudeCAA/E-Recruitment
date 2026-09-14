// Frontend mirror of backend/src/middleware/uploadConstants.js (necessarily
// duplicated - no shared package between backend/ and frontend/, same as
// validators.js/profileCompleteness.js/entryDedup.js). Lets an obviously
// invalid file (wrong type, too large) be rejected instantly in the
// browser instead of only failing after a full upload round-trip to the
// server - the server-side check in upload.js is still the real
// enforcement, this is purely a faster failure for the candidate.
export const ALLOWED_DOCUMENT_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];
export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx'];
export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB, matches MAX_FILE_SIZE in uploadConstants.js

// Returns an error message, or '' if the file is fine. Falls back to the
// extension when the browser reports no mimetype at all (some OS file
// pickers do this for certain drag-and-drop sources) rather than rejecting
// a file the server would have accepted.
export function validateDocumentFile(file) {
  if (!file) return '';
  const nameLower = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_DOCUMENT_EXTENSIONS.some((ext) => nameLower.endsWith(ext));
  const mimeOk = ALLOWED_DOCUMENT_MIME.includes(file.type) || (file.type === '' && hasAllowedExtension);
  if (!mimeOk) {
    return 'Only PDF or Word documents (.pdf, .doc, .docx) are allowed.';
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return 'This file is larger than the 10MB limit.';
  }
  return '';
}
