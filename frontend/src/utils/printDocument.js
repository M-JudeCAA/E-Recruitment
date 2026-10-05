// Opens a printable document (a full HTML body, already escaped) in a new
// window with the browser's print dialog - "Save as PDF" there gives a PDF.
// Used for the sheets and letters HR prints (the EXCO shortlist, offer
// letters, ...). Returns false if the browser blocked the window.
const PRINT_STYLES = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 32px; font-size: 13px; line-height: 1.45; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 18px 0 6px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  th, td { border: 1px solid #999; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .muted { color: #555; } .sign { margin-top: 36px; display: flex; gap: 48px; flex-wrap: wrap; }
  .sign div { min-width: 220px; border-top: 1px solid #111; padding-top: 4px; }
  @media print { body { margin: 12mm; } .no-print { display: none; } }
`;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function printDocument(title, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}</style></head>`
    + `<body><p class="no-print"><button onclick="window.print()">Print or save as PDF</button></p>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
  return true;
}
