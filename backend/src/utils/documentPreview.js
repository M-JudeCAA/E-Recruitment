const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const sanitizeHtml = require('sanitize-html');

// What an uploaded file looks like in the in-app document viewer
// (GET /api/files/:filename/preview, and the committee's equivalent).
// PDFs and images are shown by the browser itself from the file route;
// a Word (.docx) file is turned into plain HTML here, cleaned, and shown in
// a sandboxed frame. An old .doc can't be read, so it is only downloaded.

const KIND_BY_EXTENSION = {
  '.pdf': 'pdf',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.docx': 'html'
};

const kindOf = (filename) => KIND_BY_EXTENSION[path.extname(filename).toLowerCase()] || 'none';

// Only document structure and the images inside the document itself - no
// links out, no styles, no scripts. The viewer's frame is sandboxed too.
const CLEAN = {
  allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img'],
  allowedAttributes: { img: ['src', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
  allowedSchemes: [],
  allowedSchemesByTag: { img: ['data'] },
  // A data: image of an image type, nothing else.
  exclusiveFilter: (frame) => frame.tag === 'img' && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(frame.attribs.src || '')
};

// { kind, html? } for one stored file (a path already checked to be inside
// the upload folder).
async function previewOf(filePath) {
  const kind = kindOf(filePath);
  if (kind !== 'html') return { kind };
  try {
    const { value } = await mammoth.convertToHtml({ buffer: await fs.promises.readFile(filePath) });
    return { kind, html: sanitizeHtml(value, CLEAN) };
  } catch {
    // Not a readable Word document after all: offer the download instead.
    return { kind: 'none' };
  }
}

module.exports = { previewOf, kindOf };
