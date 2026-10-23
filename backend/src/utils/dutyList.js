// Job duties as typed or pasted into one text box: a bulleted or numbered
// list (from Word, a PDF or a CV), one duty per line, or several on one line
// after bullets ("• Did this • Did that"). Mirrored in
// frontend/src/utils/dutyList.js - change both together.

// Bullet glyphs, including Word's symbol-font ones (U+F0B7, U+F0A7, ...).
const BULLETS = '•●▪■◦‣⁃∙·➢✓✔►▶→⇒❖♦◆';
// A leading list marker: a bullet, a dash/asterisk/arrow, or "1." "1)"
// "(1)" "a)" "iv." followed by a space (so "e.g." and "10.5%" are kept).
const MARKER_RE = new RegExp(`^\\s*(?:[${BULLETS}]|[-\\u2013\\u2014*+>~]|\\(?(?:\\d{1,2}|[a-z]|i{1,3}|iv|vi{0,3}|ix|x)[.)](?=\\s))\\s*`, 'i');
// Bullets written inline on one line.
const INLINE_BULLET_RE = new RegExp(`\\s+[${BULLETS}]\\s+`);

function splitDuties(value) {
  if (Array.isArray(value)) value = value.join('\n');
  const lines = String(value ?? '').replace(/\r/g, '').split('\n')
    .flatMap((line) => line.split(INLINE_BULLET_RE).map((text, i) => ({ text, inline: i > 0 })));
  // Wrapped lines are only joined in a marked list; typed plain lines are
  // one duty each.
  const isList = lines.some(({ text, inline }) => inline || MARKER_RE.test(text));
  const duties = [];
  for (const { text: raw, inline } of lines) {
    const marked = inline || MARKER_RE.test(raw);
    const text = raw.replace(MARKER_RE, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const prev = duties[duties.length - 1];
    // A line that only continues the duty above (wrapped when copied: it
    // starts in lower case, has no marker, and the one above has no full
    // stop) joins it.
    if (isList && prev && !marked && /^[a-z(]/.test(text) && !/[.;:!?]$/.test(prev)) {
      duties[duties.length - 1] = `${prev} ${text}`;
      continue;
    }
    duties.push(text);
  }
  return duties;
}

// Duties as the text box shows them: one per line, bulleted.
const dutiesToText = (duties) => (duties || []).filter(Boolean).map((d) => `• ${d}`).join('\n');

module.exports = { splitDuties, dutiesToText };
