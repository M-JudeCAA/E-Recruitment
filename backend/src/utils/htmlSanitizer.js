const sanitizeHtml = require('sanitize-html');

// Mirrors the client-side whitelist exactly, so what the server accepts
// matches what the editor could have produced - but this copy is the one
// that actually matters for security, since a client-side check can always
// be bypassed by anyone calling the API directly (e.g. via curl or
// Postman) rather than through the real form.
const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li',
  'span', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'];

// A broad but firm allowlist for border/width-type values: letters, digits,
// '#', '.', ',', '%', and spaces/hyphens only. Deliberately excludes
// parentheses, quotes, and semicolons - the characters an injection via
// url(...) or expression(...) would need.
const SAFE_VALUE = /^[a-zA-Z0-9#.,%\s-]+$/;

function sanitizeJobDescription(html) {
  if (!html) return null;

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['style'],
      a: ['href'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan']
    },
    allowedStyles: {
      // Property names must be listed explicitly - sanitize-html does not
      // support wildcard property-name matching (only values support
      // regex). This bug was caught by testing the function directly:
      // an earlier version using 'margin.*' as a key silently stripped
      // all indentation, which is exactly the thing this feature must keep.
      '*': {
        'text-align': [/^left$|^right$|^center$|^justify$/],
        'vertical-align': [/^top$|^middle$|^bottom$|^baseline$/],
        'margin': [/^[\d.]+(px|em|pt|%)(\s+[\d.]+(px|em|pt|%)){0,3}$/],
        'margin-left': [/^[\d.]+(px|em|pt|%)$/],
        'margin-right': [/^[\d.]+(px|em|pt|%)$/],
        'margin-top': [/^[\d.]+(px|em|pt|%)$/],
        'margin-bottom': [/^[\d.]+(px|em|pt|%)$/],
        'padding': [/^[\d.]+(px|em|pt|%)(\s+[\d.]+(px|em|pt|%)){0,3}$/],
        'padding-left': [/^[\d.]+(px|em|pt|%)$/],
        'padding-right': [/^[\d.]+(px|em|pt|%)$/],
        'padding-top': [/^[\d.]+(px|em|pt|%)$/],
        'padding-bottom': [/^[\d.]+(px|em|pt|%)$/],
        'font-weight': [/^bold$|^normal$|^[0-9]+$/],
        'font-style': [/^italic$|^normal$/],
        'text-decoration': [/^underline$|^none$/],
        'line-height': [/^[\d.]+$/],
        // Table-specific - width/border/border-collapse are structural,
        // not typographic, so they're preserved the same way indentation is.
        'width': [SAFE_VALUE],
        'height': [SAFE_VALUE],
        'border': [SAFE_VALUE],
        'border-collapse': [/^collapse$|^separate$/],
        'border-color': [SAFE_VALUE],
        'border-width': [SAFE_VALUE],
        'border-style': [/^solid$|^dashed$|^dotted$|^double$|^none$/]
      }
    }
  });

  // A generous but firm cap - a job description is not a full document.
  const MAX_LENGTH = 20000;
  return clean.slice(0, MAX_LENGTH);
}

module.exports = { sanitizeJobDescription };
