import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import staffClient from '../models/staffApiClient';

// Who has viewed this applicant's data (FR-ATS-081,
// GET /api/audit/access/applications/:id - Manager and above): the
// applicant lists that showed them, their documents, exports and the
// shortlisting committee's views. Repeated identical views within a few
// minutes are recorded once. Collapsed and loaded only when opened.
export default function AccessLog({ applicationId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      try {
        const res = await staffClient.get(`/api/audit/access/applications/${applicationId}`);
        setRows(res.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load who viewed this applicant');
      }
    }
  };

  return (
    <div style={{ marginTop: 'var(--spacing-sm)' }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13,
          color: 'var(--color-primary-dark)', display: 'inline-flex', alignItems: 'center', gap: 4
        }}
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Who viewed this applicant
      </button>
      {open && (
        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 13 }}>
          {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
          {!error && rows === null && <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>}
          {rows && rows.length === 0 && <div style={{ color: 'var(--color-text-muted)' }}>No views recorded yet.</div>}
          {rows && rows.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid var(--color-border)' }}>
              {rows.map((row) => (
                <li key={row.id} style={{ padding: '0 0 6px var(--spacing-md)', overflowWrap: 'anywhere' }}>
                  <strong>{row.who}</strong>
                  {row.role && <span style={{ color: 'var(--color-text-muted)' }}> ({row.role.replace(/_/g, ' ')})</span>}
                  {' - '}{row.action}{row.document ? `: ${row.document}` : ''}
                  <span style={{ color: 'var(--color-text-muted)' }}>, {new Date(row.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
