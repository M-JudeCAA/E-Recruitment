import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCheck2, Upload, RefreshCw } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { fileLink } from '../utils/fileLink';
import Button from './Button';
import Alert from './Alert';
import StatusBadge from './StatusBadge';

// Step 1 of a new vacancy: the EXCO-approved, signed requisition. HR uploads
// it (POST /api/vacancies/requisition); the server reads the job details out
// of it and returns a pre-filled form. This shows what was read, how sure
// the reader is of each value, what it couldn't find, and asks HR to
// confirm the approval. CreateVacancyListing applies the pre-fill and shows
// the rest of the form only once a requisition has been read.

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CONFIDENCE_BADGE = {
  high: ['HighConfidence', 'Read'],
  medium: ['MediumConfidence', 'Check'],
  low: ['LowConfidence', 'Doubtful']
};
const EMPLOYMENT_LABELS = { FullTime: 'Full-time', Contract: 'Contract', FixedTermContract: 'Fixed term contract' };
const MAX_SHOWN = 140;

// The order facts are listed in, after which the long sections follow.
const ORDER = ['jobTitle', 'directorate', 'department', 'section', 'station', 'reportsTo', 'directReports', 'advertType',
  'vacancies', 'salaryScale', 'contractType', 'contractDuration', 'positionStatus', 'jdStatus', 'expectedReportingDate',
  'age', 'equipment', 'excoReference', 'approvalDate', 'jobReference', 'jobPurpose', 'principalAccountabilities', 'duties',
  'essential', 'desirable', 'knowledge', 'specialSkills'];

function shorten(text) {
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text;
}

function describe(key, field) {
  const { value } = field;
  if (key === 'contractType') return `${EMPLOYMENT_LABELS[value] || value}${field.raw ? ` ("${field.raw}")` : ''}`;
  if (key === 'age') {
    const parts = [value.minimumAge && `at least ${value.minimumAge}`, value.maximumAge && `not above ${value.maximumAge}`].filter(Boolean);
    return `${parts.join(', ')}${field.raw ? ` ("${field.raw}")` : ''}`;
  }
  if (Array.isArray(value)) {
    if (key === 'jobPurpose') return shorten(value.join(' '));
    return `${value.length} item${value.length === 1 ? '' : 's'} - ${shorten(value[0])}`;
  }
  return shorten(String(value));
}

function MatchLine({ label, wanted, match }) {
  if (!wanted) return null;
  return (
    <li>
      {label} "{wanted}" &rarr;{' '}
      {match
        ? <><strong>{match.name}</strong>{match.directorate ? ` (${match.directorate})` : ''}{match.confidence === 'medium' ? ' - close match, check it' : ''}</>
        : <span style={{ color: 'var(--color-warning)' }}>not matched - pick it below</span>}
    </li>
  );
}

export default function RequisitionPanel({ requisition, onRead, onReplace, confirmed, onConfirmChange }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null); // { message, existingVacancy? }

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    const body = new FormData();
    body.append('document', file);
    try {
      const res = await staffClient.post('/api/vacancies/requisition', body);
      onRead(res.data);
    } catch (err) {
      setError({ message: err.response?.data?.error || 'The requisition could not be read', existingVacancy: err.response?.data?.existingVacancy });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const picker = (
    <input ref={inputRef} type="file" accept={ACCEPT} style={{ display: 'none' }}
      onChange={(e) => upload(e.target.files?.[0])} aria-label="Requisition document" />
  );

  if (!requisition) {
    return (
      <div>
        {picker}
        <p style={{ fontSize: 14, marginTop: 0 }}>
          A vacancy can only be created from a requisition that EXCO has approved and signed. Upload it as a
          Word (.docx) document or a PDF saved from Word - not a scan - and its job details are read into the form for you to check.
        </p>
        {error && (
          <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}>
            {error.message}
            {error.existingVacancy && <> <Link to={`/hr/vacancy/${error.existingVacancy.id}`}>Open {error.existingVacancy.jobRef}</Link></>}
          </div>
        )}
        <Button type="button" onClick={() => inputRef.current?.click()} loading={busy} loadingText="Reading the requisition...">
          <Upload size={15} /> Upload approved requisition
        </Button>
      </div>
    );
  }

  const { document, fields, labels, missing, warnings, organogram } = requisition;
  const keys = ORDER.filter((k) => fields[k]);
  const toCheck = keys.filter((k) => fields[k].confidence !== 'high').length;

  return (
    <div>
      {picker}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <FileCheck2 size={18} color="var(--color-accent)" />
          <a href={fileLink(document.url)} target="_blank" rel="noreferrer" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{document.originalName}</a>
        </div>
        <Button type="button" variant="ghost" onClick={() => { onReplace(); inputRef.current?.click(); }} style={{ padding: '4px 10px', fontSize: 13 }}>
          <RefreshCw size={14} /> Replace document
        </Button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>
        Read {keys.length} detail{keys.length === 1 ? '' : 's'} from the requisition
        {toCheck > 0 && <> - <strong style={{ color: 'var(--color-warning)' }}>{toCheck} to check</strong></>}
        {missing.length > 0 && <> - <strong>{missing.length} not found</strong></>}. Everything below is pre-filled from it; correct anything that is wrong.
      </p>

      {warnings.length > 0 && <Alert type="warning" message={<ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>} />}

      <ul style={{ fontSize: 13, margin: '0 0 12px', paddingLeft: 18 }}>
        <MatchLine label="Department" wanted={fields.department?.value} match={organogram.department} />
        <MatchLine label="Job title" wanted={fields.jobTitle?.value} match={organogram.position} />
        <MatchLine label="Reports to" wanted={fields.reportsTo?.value} match={organogram.reportsTo} />
      </ul>

      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {keys.map((k) => {
              const [badge, label] = CONFIDENCE_BADGE[fields[k].confidence] || CONFIDENCE_BADGE.low;
              return (
                <tr key={k} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{labels[k] || k}</td>
                  <td style={{ padding: '6px 10px', overflowWrap: 'anywhere' }}>{describe(k, fields[k])}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', verticalAlign: 'top' }}><StatusBadge status={badge} label={label} /></td>
                </tr>
              );
            })}
            {missing.map((k) => (
              <tr key={k} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{labels[k] || k}</td>
                <td style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}>Not found in the document - fill it in below if it applies</td>
                <td style={{ padding: '6px 10px', textAlign: 'right' }}><StatusBadge status="NotFound" label="Not found" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, marginTop: 16, cursor: 'pointer' }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} style={{ marginTop: 3, flexShrink: 0 }} />
        <span>I confirm this requisition has been <strong>approved and signed by EXCO</strong>, and that this vacancy is created from it.</span>
      </label>
    </div>
  );
}
