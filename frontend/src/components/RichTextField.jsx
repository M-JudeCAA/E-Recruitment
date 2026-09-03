import React, { useRef, useEffect } from 'react';
import DOMPurify from 'dompurify';

// Tags/attributes allowed through from a Word (or any rich source) paste.
// Notably absent: <font>, and no font-family/font-size ever survives -
// those are stripped explicitly below, regardless of whether they arrive
// as inline styles or via the legacy <font> tag (which is simply not in
// this whitelist, so DOMPurify drops the tag but keeps its text).
const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li',
  'span', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'];
const ALLOWED_ATTR = ['style', 'href', 'colspan', 'rowspan'];

function stripFontsPreserveEverythingElse(html) {
  const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
  const container = document.createElement('div');
  container.innerHTML = safe;

  container.querySelectorAll('*').forEach((el) => {
    if (el.style) {
      // These three are the only properties removed. Everything else -
      // margin, padding, text-align, font-weight, font-style,
      // text-decoration, line-height - passes through untouched, which is
      // what preserves indentation and spacing from the source document.
      el.style.removeProperty('font-family');
      el.style.removeProperty('font-size');
      el.style.removeProperty('font');
    }
    // Word tags every paragraph with classes like "MsoNormal" /
    // "MsoListParagraph" - harmless without Word's stylesheet, but worth
    // stripping so no stray Word CSS class ever collides with our own.
    if (el.className && /Mso/i.test(el.className)) {
      el.removeAttribute('class');
    }
  });

  return container.innerHTML;
}

/**
 * Controlled rich-text field for pasted content. Preserves bold, italics,
 * underline, lists, indentation, alignment, and spacing from whatever was
 * copied (e.g. a Word document) - but always renders in the system's own
 * font, never whatever font the source document used.
 */
export default function RichTextField({ label, value, onChange, placeholder }) {
  const editorRef = useRef(null);

  // Keep the DOM in sync when value changes externally (e.g. loading an
  // existing vacancy into the edit modal) without fighting the cursor
  // position during normal typing.
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const handlePaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');

    let cleaned;
    if (html) {
      cleaned = stripFontsPreserveEverythingElse(html);
    } else {
      // Plain-text fallback (e.g. pasting from Notepad) - no formatting
      // to preserve, just wrap each line as its own paragraph.
      cleaned = text
        .split('\n')
        .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`)
        .join('');
    }

    document.execCommand('insertHTML', false, cleaned);
    onChange(editorRef.current.innerHTML);
  };

  return (
    <label style={{ display: 'block', marginBottom: 'var(--spacing-md)' }}>
      {label && (
        <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          {label}
        </span>
      )}
      <div
        ref={editorRef}
        contentEditable
        onPaste={handlePaste}
        onInput={() => onChange(editorRef.current.innerHTML)}
        className="rich-text-content"
        data-placeholder={placeholder}
        style={{
          minHeight: 160,
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 10,
          fontSize: 'inherit'
        }}
      />
    </label>
  );
}
