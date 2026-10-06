// Saves rows already on screen as a CSV file - for lists with no personal
// data (the vacancy list). Exports of candidate data go through the API
// instead, so they are access-logged (CsvDownloadButton).
// Same rules as backend utils/csv.js: RFC 4180 quoting, CRLF, a UTF-8 BOM
// for Excel, and text that starts like a formula (= + - @) is prefixed
// with an apostrophe so a spreadsheet won't run it.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** columns: [{ header, value: (row) => any }] */
export function downloadCsv(filename, columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
