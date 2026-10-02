const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { AppError } = require('./errorResponse');

// Text extraction for uploaded documents that are read, not just stored -
// the EXCO-approved requisition (services/requisitionService.js). Only
// documents with a real text layer can be read: a scanned page is an image,
// and this system does no OCR, so a scan is refused with a clear message
// rather than producing an empty or garbled form.

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const READABLE_MIME = [PDF_MIME, DOCX_MIME];

// Below this much text a document can't be a filled-in requisition. Per
// PDF page, so a long scan with one typed line per page is still caught.
const MIN_TEXT_CHARS = 150;
const MIN_TEXT_CHARS_PER_PDF_PAGE = 40;

const SCANNED_MESSAGE = 'This document has no readable text - it looks like a scanned copy. '
  + 'Upload the requisition as a Word (.docx) file or a PDF saved from Word (not scanned), so its details can be read.';

// pdf-parse's bundled pdf.js reads the whole ArrayBuffer behind a Buffer,
// ignoring its offset - and Node packs small Buffers into one shared pool,
// so a small PDF could be read as the pool's other contents ("bad XRef
// entry"). A copy with its own ArrayBuffer is always read correctly.
function standaloneBytes(buffer) {
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
}

function countTextChars(text) {
  return (text || '').replace(/\s+/g, '').length;
}

// { text, format: 'pdf' | 'docx', pages } - throws AppError 422 with code
// SCANNED_DOCUMENT or UNSUPPORTED_DOCUMENT.
async function extractDocumentText(buffer, mimetype) {
  if (!READABLE_MIME.includes(mimetype)) {
    const err = new AppError('Upload the requisition as a PDF or a Word (.docx) document. Older .doc files and images cannot be read.', 422);
    err.code = 'UNSUPPORTED_DOCUMENT';
    throw err;
  }

  let text;
  let pages = 1;
  try {
    if (mimetype === PDF_MIME) {
      const data = await pdfParse(standaloneBytes(buffer));
      text = data.text || '';
      pages = data.numpages || 1;
    } else {
      text = (await mammoth.extractRawText({ buffer })).value || '';
    }
  } catch (err) {
    const unreadable = new AppError('This file could not be opened. Check that it is a valid, unprotected PDF or Word (.docx) document.', 422);
    unreadable.code = 'UNREADABLE_DOCUMENT';
    throw unreadable;
  }

  const chars = countTextChars(text);
  if (chars < MIN_TEXT_CHARS || (mimetype === PDF_MIME && chars < MIN_TEXT_CHARS_PER_PDF_PAGE * pages)) {
    const err = new AppError(SCANNED_MESSAGE, 422);
    err.code = 'SCANNED_DOCUMENT';
    throw err;
  }
  return { text, format: mimetype === PDF_MIME ? 'pdf' : 'docx', pages };
}

module.exports = { extractDocumentText, standaloneBytes, READABLE_MIME, PDF_MIME, DOCX_MIME, MIN_TEXT_CHARS };
