import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import staffClient from '../models/staffApiClient';

// The audit history of one vacancy, application, offer or interview round
// (GET /api/audit/:entityType/:entityId): who did what and when, the values
// that changed, and any comment given. Collapsed until opened, and loaded
// only then - most reviews never need it.

const MAX_VALUE_LENGTH = 80;

// "salaryAmount" -> "Salary amount"
function fieldLabel(field) {
  const words = field.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describeValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
  const text = typeof value === 'string' ? value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : JSON.stringify(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}

function describeActor(row) {
  if (row.byCandidate) return 'the candidate';
  if (!row.performedBy) return 'the system';
  const role = row.performedBy.role ? ` (${row.performedBy.role.replace(/_/g, ' ')})` : '';
  return `${row.performedBy.name}${role}${row.actingAsId ? ', under delegation' : ''}`;
}

export default function AuditTrail({ entityType, entityId, label = 'History' }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      try {
        const res = await staffClient.get(`/api/audit/${entityType}/${entityId}`);
        setRows(res.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load the history');
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
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {label}
      </button>
      {open && (
        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: 13 }}>
          {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
          {!error && rows === null && <div style={{ color: 'var(--color-text-muted)' }}>Loading...</div>}
          {rows && rows.length === 0 && <div style={{ color: 'var(--color-text-muted)' }}>Nothing recorded yet.</div>}
          {rows && rows.length > 0 && (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: '2px solid var(--color-border)' }}>
              {rows.map((row) => (
                <li key={row.id} style={{ padding: '0 0 var(--spacing-sm) var(--spacing-md)' }}>
                  <div>
                    <strong>{row.action}</strong>
                    <span style={{ color: 'var(--color-text-muted)' }}> — {describeActor(row)}, {new Date(row.timestamp).toLocaleString()}</span>
                  </div>
                  {row.changes && (
                    <ul style={{ margin: '2px 0 0', paddingLeft: 18, color: 'var(--color-text-muted)' }}>
                      {Object.entries(row.changes).map(([field, { from, to }]) => (
                        <li key={field} style={{ overflowWrap: 'anywhere' }}>
                          {fieldLabel(field)}: {describeValue(from)} &rarr; {describeValue(to)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.comment && (
                    <div style={{ marginTop: 2, fontStyle: 'italic', overflowWrap: 'anywhere' }}>&ldquo;{row.comment}&rdquo;</div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
