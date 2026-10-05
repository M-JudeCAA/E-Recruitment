// CSV for the HR exports (FR-ATS-053). RFC 4180 quoting, CRLF line ends and
// a UTF-8 byte-order mark so Excel opens names with accents correctly.
//
// Cells beginning with = + - @ (or a tab/CR) would be run as a formula by
// Excel or Sheets - and candidates type their own names and answers - so
// such text is prefixed with an apostrophe. Real numbers are left alone.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// columns: [{ header, value: (row) => any }]
function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// A filename-safe slug of a job reference: UCAA/ADV/EXT/007/2026 -> UCAA-ADV-EXT-007-2026
function fileSlug(text) {
  return String(text || 'export').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sendCsv(res, filename, csv) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.set('Cache-Control', 'no-store');
  res.send(csv);
}

module.exports = { cell, toCsv, fileSlug, sendCsv };
