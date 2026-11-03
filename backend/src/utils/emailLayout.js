const { escapeHtml } = require('./interviewFormat');

// The one look of every email the system sends (utils/mailer.js frames any
// email that isn't laid out already): a header band, an optional title, the
// message, an optional highlighted quote (HR's comment) and details table, a
// button, and a footer. Tables and inline styles only - what Outlook and
// Gmail render alike; no images, no scripts, no web fonts.

const COLOURS = {
  canvas: '#EEF2F6', card: '#FFFFFF', band: '#0E2A47', accent: '#1C719D',
  text: '#1F2933', muted: '#5F6B7A', rule: '#DDE3EA', quoteBg: '#FDF3E1', quoteEdge: '#A66A00'
};
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const AUDIENCE = {
  candidate: { sub: 'e-Recruitment', note: 'You get this email because you have an account on UCAA e-Recruitment.' },
  staff: { sub: 'e-Recruitment · Staff workspace', note: 'You get this email because of your role in UCAA e-Recruitment.' },
  general: { sub: 'e-Recruitment', note: '' }
};

/** Plain text as HTML paragraphs: blank lines split paragraphs, single newlines become <br>. */
function paragraphs(text) {
  return String(text || '').trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function button({ label, url }) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 6px"><tr>
<td style="border-radius:4px;background:${COLOURS.accent}"><a href="${escapeHtml(url)}" target="_blank"
 style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:4px">${escapeHtml(label)}</a></td>
</tr></table>`;
}

function quote({ label, text }) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 16px"><tr>
<td style="background:${COLOURS.quoteBg};border-left:4px solid ${COLOURS.quoteEdge};padding:12px 16px;font-family:${FONT};font-size:15px;line-height:1.55;color:${COLOURS.text}">
${label ? `<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${COLOURS.quoteEdge};margin-bottom:4px">${escapeHtml(label)}</div>` : ''}
${escapeHtml(text).replace(/\n/g, '<br>')}</td></tr></table>`;
}

function details(rows) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 16px;border-top:1px solid ${COLOURS.rule}">
${rows.map(([label, value]) => `<tr>
<td style="padding:8px 12px 8px 0;border-bottom:1px solid ${COLOURS.rule};font-size:14px;color:${COLOURS.muted};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
<td style="padding:8px 0;border-bottom:1px solid ${COLOURS.rule};font-size:14px;color:${COLOURS.text}">${escapeHtml(value)}</td></tr>`).join('')}
</table>`;
}

/**
 * A whole email document. Text inputs are escaped; bodyHtml and footerHtml
 * are trusted markup built by the caller. audience: candidate | staff | general.
 */
function renderEmail({ title, preheader, greeting, text, bodyHtml, quote: quoted, details: rows, button: action, footerHtml, audience = 'general' }) {
  const who = AUDIENCE[audience] || AUDIENCE.general;
  const body = [
    title ? `<h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;font-weight:700;color:${COLOURS.band}">${escapeHtml(title)}</h1>` : '',
    greeting ? `<p style="margin:0 0 14px">${escapeHtml(greeting)}</p>` : '',
    text ? paragraphs(text) : '',
    quoted?.text ? quote(quoted) : '',
    rows?.length ? details(rows) : '',
    bodyHtml || '',
    action?.url ? button(action) : ''
  ].join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(title || 'UCAA e-Recruitment')}</title></head>
<body style="margin:0;padding:0;background:${COLOURS.canvas}">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLOURS.canvas}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${COLOURS.card};border:1px solid ${COLOURS.rule};border-radius:8px;overflow:hidden">
<tr><td style="background:${COLOURS.band};border-bottom:4px solid ${COLOURS.accent};padding:18px 28px;font-family:${FONT}">
<div style="font-size:17px;font-weight:700;color:#FFFFFF">Uganda Civil Aviation Authority</div>
<div style="font-size:13px;color:#C8D6E5;margin-top:2px">${escapeHtml(who.sub)}</div></td></tr>
<tr><td style="padding:28px 28px 22px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLOURS.text}">${body}</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid ${COLOURS.rule};font-family:${FONT};font-size:12px;line-height:1.5;color:${COLOURS.muted}">
<div>Uganda Civil Aviation Authority · Human Resources</div>
${who.note ? `<div style="margin-top:4px">${escapeHtml(who.note)}</div>` : ''}
${footerHtml ? `<div style="margin-top:8px">${footerHtml}</div>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

const isDocument = (html) => /^\s*<!doctype html/i.test(String(html || ''));

/** A readable plain-text copy of an email, for mail clients that want one. */
function toText(html) {
  return String(html || '')
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<(head|style|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => `${label.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|table)>/gi, '\n\n')
    .replace(/<\/(div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { renderEmail, isDocument, toText, paragraphs, COLOURS };
