const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Legacy binary .doc has no cheap extraction library available here -
// mammoth only handles .docx. Rejected explicitly for this endpoint only;
// the unrelated application-level CV upload (upload.js) still accepts it,
// since that's just stored, never parsed.
class UnsupportedCvFormatError extends Error {}

async function extractText(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimetype === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new UnsupportedCvFormatError('Only PDF or Word (.docx) files are supported for CV autofill');
}

module.exports = { extractText, UnsupportedCvFormatError };
