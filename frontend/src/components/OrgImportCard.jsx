import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import CsvDownloadButton from './CsvDownloadButton';

// Batch import of directorates, departments and positions from a spreadsheet
// (backend orgImportService.js). Upload -> every row checked (nothing is
// changed) -> Import, which takes the whole file or nothing. New departments
// arrive pending, for a Principal HR Officer to approve.

const STATUS = {
  new: { label: 'Will be added', color: 'var(--color-accent)' },
  exists: { label: 'Already there', color: 'var(--color-text-muted)' },
  warning: { label: 'Check', color: 'var(--color-warning)' },
  error: { label: 'Fix this', color: 'var(--color-danger)' }
};
const CREATES = { directorate: 'directorate', department: 'department (pending)', position: 'position' };
const ROWS_SHOWN = 200;

const cell = { padding: '6px 10px', borderTop: '1px solid var(--color-border)', verticalAlign: 'top' };

export default function OrgImportCard({ onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);

  const send = (path) => {
    const body = new FormData();
    body.append('file', file);
    return staffClient.post(path, body);
  };

  const choose = async (picked) => {
    if (!picked) return;
    setFile(picked); setPreview(null); setError(''); setDone(''); setBusy('preview');
    const body = new FormData();
    body.append('file', picked);
    try {
      const res = await staffClient.post('/api/org-import/preview', body);
      setPreview(res.data);
      setOnlyProblems(res.data.summary.errors > 0);
    } catch (err) {
      setError(err.response?.data?.error || 'The file could not be checked');
      setFile(null);
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const runImport = async () => {
    setBusy('import'); setError('');
    try {
      const res = await send('/api/org-import');
      const r = res.data;
      const parts = [
        r.directorates && `${r.directorates} directorate(s)`,
        r.departments && `${r.departments} department(s), awaiting approval`,
        r.positions && `${r.positions} position(s)`
      ].filter(Boolean);
      setDone(`Imported ${parts.join(', ')}.${r.skipped ? ` ${r.skipped} row(s) were already there.` : ''}`);
      setPreview(null); setFile(null);
      onImported?.();
    } catch (err) {
      const data = err.response?.data;
      if (data?.rows) { setPreview({ fileName: file.name, rows: data.rows, summary: data.summary }); setOnlyProblems(true); }
      setError(data?.error || 'The import failed - nothing was changed');
    } finally {
      setBusy('');
    }
  };

  const s = preview?.summary;
  const rows = preview ? preview.rows.filter((r) => !onlyProblems || r.status === 'error' || r.status === 'warning') : [];

  return (
    <Card accent="var(--color-primary)">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet size={18} /> Import from a spreadsheet</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Add many directorates, departments and positions at once from an Excel (.xlsx) or CSV file, one row per
            position. Nothing already in the system is changed. New departments still need Principal HR Officer approval,
            and their positions can be used on a vacancy once it is approved.
          </p>
        </div>
        <CsvDownloadButton url="/api/org-import/template" label="Download template" fallbackName="org-structure-import-template.xlsx" />
      </div>

      <input ref={inputRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} aria-label="Spreadsheet to import"
        onChange={(e) => choose(e.target.files?.[0])} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button type="button" variant={preview ? 'ghost' : 'primary'} onClick={() => inputRef.current?.click()}
          loading={busy === 'preview'} loadingText="Checking the file...">
          <Upload size={15} /> {preview ? 'Choose a different file' : 'Choose a file to check'}
        </Button>
        {preview && s.errors === 0 && (
          <Button type="button" onClick={runImport} loading={busy === 'import'} loadingText="Importing..."
            disabled={!s.directorates && !s.departments && !s.positions}>
            Import {[s.directorates && `${s.directorates} directorate(s)`, s.departments && `${s.departments} department(s)`, s.positions && `${s.positions} position(s)`].filter(Boolean).join(', ') || 'nothing new'}
          </Button>
        )}
      </div>

      <Alert type="success" message={done} />
      <Alert type="error" message={error} />

      {preview && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 14, margin: '0 0 8px' }}>
            <strong>{preview.fileName}</strong>: {s.rows} row(s) checked
            {' - '}{s.directorates} new directorate(s), {s.departments} new department(s), {s.positions} new position(s), {s.skipped} already there
            {s.warnings > 0 && <>, <span style={{ color: 'var(--color-warning)' }}>{s.warnings} to check</span></>}
            {s.errors > 0 && <>, <strong style={{ color: 'var(--color-danger)' }}>{s.errors} to fix</strong></>}.
          </p>
          {s.errors > 0 && (
            <Alert type="warning" message="Fix the rows marked below in your spreadsheet and choose it again. Nothing is imported until every row is valid." />
          )}
          <label style={{ fontSize: 13, display: 'inline-flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            Only show rows to fix or check
          </label>
          <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-subtle)', textAlign: 'left' }}>
                  {['Row', 'Directorate', 'Department', 'Position', 'Level', 'Result'].map((h) => <th key={h} style={{ padding: '6px 10px' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, ROWS_SHOWN).map((r) => (
                  <tr key={r.rowNumber}>
                    <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>{r.rowNumber}</td>
                    <td style={cell}>{r.directorate}</td>
                    <td style={cell}>{r.department}</td>
                    <td style={cell}>{r.position || <span style={{ color: 'var(--color-text-muted)' }}>-</span>}</td>
                    <td style={cell}>{r.levelLabel || r.level}</td>
                    <td style={{ ...cell, minWidth: 200 }}>
                      <strong style={{ color: STATUS[r.status].color }}>{STATUS[r.status].label}</strong>
                      {r.creates.length > 0 && <span style={{ color: 'var(--color-text-muted)' }}> - new {r.creates.map((c) => CREATES[c]).join(', ')}</span>}
                      {r.messages.map((m) => <div key={m} style={{ color: r.status === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>{m}</div>)}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ ...cell, color: 'var(--color-text-muted)' }}>No rows to fix or check.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {rows.length > ROWS_SHOWN && (
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Showing the first {ROWS_SHOWN} of {rows.length} rows.</p>
          )}
        </div>
      )}
    </Card>
  );
}
