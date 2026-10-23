const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { standaloneBytes } = require('./documentText');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Legacy binary .doc has no cheap extraction library available here -
// mammoth only handles .docx. Rejected explicitly for this endpoint only;
// the unrelated application-level CV upload (upload.js) still accepts it,
// since that's just stored, never parsed.
class UnsupportedCvFormatError extends Error {}

// Text of a CV, laid out so cvHeuristics can read it whatever the template:
// one line per visual line, a blank line between blocks, " | " where a line
// has a wide gap (a table cell, a date pushed to the right margin), and a
// two-column page (sidebar + main column) read one column after the other
// instead of the two interleaved line by line.
async function extractText(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    // See documentText.standaloneBytes - a small upload can sit in Node's
    // shared Buffer pool, which pdf.js misreads.
    const bytes = standaloneBytes(buffer);
    try {
      const data = await pdfParse(bytes, { pagerender: renderPdfPage });
      if (data.text.trim()) return data.text;
    } catch {
      // Fall back to pdf-parse's own reading below.
    }
    return (await pdfParse(standaloneBytes(buffer))).text;
  }
  if (mimetype === DOCX_MIME) {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const text = htmlToLines(html);
    return text.trim() ? text : (await mammoth.extractRawText({ buffer })).value;
  }
  throw new UnsupportedCvFormatError('Only PDF or Word (.docx) files are supported for CV autofill');
}

// ---- PDF -------------------------------------------------------------------

function textItems(content) {
  return content.items
    .filter((it) => typeof it.str === 'string' && it.str.trim())
    .map((it) => {
      const size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || it.height || 10;
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * size * 0.5, size };
    });
}

// The x of a vertical gutter that splits the page into two columns, or null:
// a band no text crosses, with real text on both sides over most of the
// page's height. Text crossing it (a full-width name or banner) is allowed
// only above both columns.
function findGutter(items, pageWidth) {
  if (items.length < 12) return null;
  const chars = (list) => list.reduce((n, it) => n + it.str.length, 0);
  const total = chars(items);
  let best = null;
  let run = null;
  for (let g = pageWidth * 0.2; g <= pageWidth * 0.8; g += 2) {
    const crossing = items.filter((it) => it.x < g - 1 && it.x + it.w > g + 1);
    const left = items.filter((it) => it.x + it.w <= g + 1);
    const right = items.filter((it) => it.x >= g - 1);
    const columnsTop = Math.min(Math.max(...left.map((it) => it.y), -Infinity), Math.max(...right.map((it) => it.y), -Infinity));
    const ok = left.length && right.length
      && chars(left) >= total * 0.12 && chars(right) >= total * 0.12
      && crossing.every((it) => it.y > columnsTop);
    if (ok) {
      run = run ? { ...run, to: g } : { from: g, to: g };
      if (!best || run.to - run.from > best.to - best.from) best = { ...run };
    } else {
      run = null;
    }
  }
  if (!best || best.to - best.from < 6) return null;
  const g = (best.from + best.to) / 2;
  // Both columns must run down the page together, not sit one above the other.
  const span = (list) => [Math.min(...list.map((it) => it.y)), Math.max(...list.map((it) => it.y))];
  const [l0, l1] = span(items.filter((it) => it.x + it.w <= g));
  const [r0, r1] = span(items.filter((it) => it.x >= g));
  const overlap = Math.min(l1, r1) - Math.max(l0, r0);
  return overlap > 0.3 * Math.min(l1 - l0, r1 - r0) ? g : null;
}

function linesOf(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= Math.max(2, Math.min(line.size, it.size) * 0.45)) line.items.push(it);
    else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  return lines.map((line) => {
    const parts = line.items.sort((a, b) => a.x - b.x);
    let text = '';
    let end = null;
    for (const it of parts) {
      if (end !== null) {
        const gap = it.x - end;
        if (gap > it.size * 2.2) text += ' | ';
        else if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      text += it.str;
      end = it.x + it.w;
    }
    return { y: line.y, size: line.size, text: text.replace(/\s+/g, ' ').trim() };
  }).filter((l) => l.text);
}

// Lines with a blank line wherever the vertical gap is clearly wider than
// the usual line spacing (a new block).
function joinLines(lines) {
  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;
  return lines.map((l, i) => (i && lines[i - 1].y - l.y > usual * 1.6 ? `\n${l.text}` : l.text)).join('\n');
}

async function renderPdfPage(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const items = textItems(content);
  const view = pageData.view || [0, 0, 595, 842];
  const gutter = findGutter(items, view[2] - view[0]);
  if (gutter === null) return joinLines(linesOf(items));
  let left = items.filter((it) => it.x + it.w <= gutter + 1);
  let right = items.filter((it) => it.x >= gutter - 1);
  // Text above where the other column starts (the name, a title) is the
  // page's header, read first.
  const topOf = (list) => Math.max(...list.map((it) => it.y + it.size * 0.5));
  const [leftTop, rightTop] = [topOf(left), topOf(right)];
  const above = (it, otherTop) => it.y > otherTop + it.size;
  const banner = items.filter((it) => (!left.includes(it) && !right.includes(it))
    || (left.includes(it) && above(it, rightTop)) || (right.includes(it) && above(it, leftTop)));
  left = left.filter((it) => !banner.includes(it));
  right = right.filter((it) => !banner.includes(it));
  // The wider column is the main one (experience, education); the sidebar
  // (contacts, skills) goes after it so a heading in one never swallows the other.
  const width = (list) => Math.max(...list.map((it) => it.x + it.w)) - Math.min(...list.map((it) => it.x));
  const [main, side] = width(right) >= width(left) ? [right, left] : [left, right];
  return [banner, main, side].filter((list) => list.length).map((list) => joinLines(linesOf(list))).join('\n\n');
}

// ---- Word ------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(text) {
  return text
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m);
}
const inline = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// mammoth's HTML as lines: a paragraph or heading per line, list items with
// a bullet, a table row as its cells joined by " | " (a row of a CV table is
// one entry - dates | institution | award), blank lines between blocks.
function htmlToLines(html) {
  const out = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let last = 0;
  const flow = (chunk) => {
    const blockRe = /<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = blockRe.exec(chunk))) {
      const text = inline(m[2]);
      if (!text) continue;
      if (/^h/i.test(m[1])) out.push('');
      out.push(m[1].toLowerCase() === 'li' ? `• ${text}` : text);
    }
  };
  let t;
  while ((t = tableRe.exec(html))) {
    flow(html.slice(last, t.index));
    out.push('');
    for (const row of t[0].match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => {
        // A cell holding several paragraphs keeps them apart.
        const paras = (c.match(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi) || [c]).map(inline).filter(Boolean);
        return paras.join(' / ');
      }).filter(Boolean);
      if (cells.length) out.push(cells.join(' | '));
    }
    out.push('');
    last = t.index + t[0].length;
  }
  flow(html.slice(last));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = { extractText, UnsupportedCvFormatError, htmlToLines, findGutter };
