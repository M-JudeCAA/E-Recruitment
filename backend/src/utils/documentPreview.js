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

// "JOB REF : UCAA/ADV/...", "REPORTS TO : ..." - a short label, a colon, the value.
const LABEL_LINE_RE = /^([A-Za-z][A-Za-z0-9 .,&;/()'’-]{0,40}?)\s*:\s*(.*)$/s;
const MIN_LABEL_ROWS = 2;

const paragraphText = (inner) => inner.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function labelOf(text) {
  const match = LABEL_LINE_RE.exec(text);
  if (!match || match[1].trim().split(/\s+/).length > 5) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function columnsOf(rowHtml) {
  let count = 0;
  for (const cell of rowHtml.matchAll(/<t[dh](?:\s+colspan="(\d+)")?[^>]*>/g)) count += Number(cell[1] || 1);
  return Math.max(count, 2);
}

// UCAA's job advertisement opens with labelled lines (Job ref, Position,
// Reports to, Salary level, Vacancies, Job purpose) and then the JD table;
// in a requisition's preview those lines become the first rows of that
// table, so the facts and the JD read as one table. A paragraph without a
// label continues the row above it (the job purpose runs over several).
// Anything else between them and the table leaves the document as it is.
function tabulateAdvertHeader(html) {
  const tableAt = html.indexOf('<table>');
  if (tableAt < 0) return html;
  const head = html.slice(0, tableAt);
  const paragraphs = [...head.matchAll(/<p>(.*?)<\/p>/gs)];
  const first = paragraphs.findIndex((p) => labelOf(paragraphText(p[1])));
  if (first < 0) return html;
  const startAt = paragraphs[first].index;
  const rest = paragraphs.slice(first);
  if (rest.map((p) => p[0]).join('') !== head.slice(startAt).trim()) return html;

  const rows = [];
  for (const p of rest) {
    const text = paragraphText(p[1]);
    const labelled = labelOf(text);
    if (labelled) rows.push(labelled);
    else if (text) rows[rows.length - 1].value = `${rows[rows.length - 1].value} ${text}`.trim();
  }
  if (rows.length < MIN_LABEL_ROWS) return html;

  const firstRow = /<tr>.*?<\/tr>/s.exec(html.slice(tableAt));
  const span = (firstRow ? columnsOf(firstRow[0]) : 2) - 1;
  const cells = rows.map(({ label, value }) =>
    `<tr><td><p><strong>${label}</strong></p></td><td${span > 1 ? ` colspan="${span}"` : ''}><p>${value}</p></td></tr>`).join('');
  return `${head.slice(0, startAt)}<table>${cells}${html.slice(tableAt + '<table>'.length)}`;
}

const isRequisition = (filePath) => /^requisition-(?!signed-)/.test(path.basename(filePath));

// { kind, html? } for one stored file (a path already checked to be inside
// the upload folder).
async function previewOf(filePath) {
  const kind = kindOf(filePath);
  if (kind !== 'html') return { kind };
  try {
    const { value } = await mammoth.convertToHtml({ buffer: await fs.promises.readFile(filePath) });
    const html = sanitizeHtml(value, CLEAN);
    return { kind, html: isRequisition(filePath) ? tabulateAdvertHeader(html) : html };
  } catch {
    // Not a readable Word document after all: offer the download instead.
    return { kind: 'none' };
  }
}

module.exports = { previewOf, kindOf, tabulateAdvertHeader };
