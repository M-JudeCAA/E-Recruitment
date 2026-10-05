import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Printer, Upload, FileText, Gavel } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { fileLink } from '../utils/fileLink';
import { printFromApi } from '../utils/printDocument';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import TextField from './TextField';
import { hintText, sectionLabel } from './interviews/formStyles';

// EXCO approves the interview shortlist outside the system. Once a
// Principal HR Officer has approved it here, HR prints it for EXCO, then
// attaches the signed copy - ticking anyone EXCO struck off. Candidates are
// told (shortlisted, or not successful) only then, and no first interview
// can be booked before (backend excoShortlistController).

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
export default function ExcoShortlistPanel({ vacancyId, staffRole, onChanged }) {
  const canAttach = (ROLE_RANK[staffRole] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState('');
  const [approvedOn, setApprovedOn] = useState('');
  const [struck, setStruck] = useState([]);
  const fileRef = useRef(null);

  const load = useCallback(() => {
    staffClient.get(`/api/vacancies/${vacancyId}/exco-shortlist`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load the EXCO shortlist'));
  }, [vacancyId]);
  useEffect(() => { load(); }, [load]);

  if (!data || (data.awaiting.length === 0 && data.approvals.length === 0)) {
    return error ? <Alert type="error" message={error} /> : null;
  }

  // The sheet comes from the "Interview shortlist for EXCO" document template.
  const print = async () => {
    const problem = await printFromApi(staffClient, `/api/documents/vacancies/${vacancyId}/exco-shortlist`);
    if (problem) setError(problem);
  };

  const attach = async () => {
    if (!file) { setError('Choose the scan of the shortlist as EXCO signed it'); return; }
    setBusy(true); setError(''); setNotice('');
    const body = new FormData();
    body.append('document', file);
    body.append('excoReference', reference);
    if (approvedOn) body.append('approvedOn', approvedOn);
    body.append('struckOff', JSON.stringify(struck));
    try {
      const res = await staffClient.post(`/api/vacancies/${vacancyId}/exco-shortlist`, body);
      setNotice(`EXCO approval attached: ${res.data.approved} approved for interview${res.data.struckOff ? `, ${res.data.struckOff} struck off and told` : ''}. The shortlisted candidates have been told, and their interviews can now be scheduled.`);
      setFile(null); setReference(''); setApprovedOn(''); setStruck([]);
      if (fileRef.current) fileRef.current.value = '';
      load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not attach the EXCO approval');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card accent={data.awaiting.length ? 'var(--color-warning)' : 'var(--color-accent)'}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Gavel size={20} color="var(--color-primary)" />
        <div style={{ flex: 1, minWidth: 240 }}>
          <strong>EXCO approval of the interview shortlist</strong>
          {data.awaiting.length > 0 ? (
            <p style={{ ...hintText, fontSize: 13, margin: '4px 0 0' }}>
              {data.awaiting.length} candidate{data.awaiting.length === 1 ? ' is' : 's are'} waiting for EXCO. Print the shortlist, have EXCO sign it, then attach the
              signed copy here. Until then they aren't told they're shortlisted and can't be scheduled.
            </p>
          ) : <p style={{ ...hintText, fontSize: 13, margin: '4px 0 0' }}>Everyone on the shortlist has been through EXCO.</p>}
        </div>
        {data.awaiting.length > 0 && <Button variant="secondary" onClick={print}><Printer size={14} /> Print for EXCO</Button>}
      </div>
      <Alert type="error" message={error} />
      <Alert type="success" message={notice} />

      {data.awaiting.length > 0 && canAttach && (
        <div style={{ marginTop: 12 }}>
          <span style={sectionLabel}>Struck off by EXCO? Tick them - they are rejected and told.</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 10 }}>
            {data.awaiting.map((a) => (
              <label key={a.applicationId} style={{ fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={struck.includes(a.applicationId)}
                  onChange={(e) => setStruck(e.target.checked ? [...struck, a.applicationId] : struck.filter((id) => id !== a.applicationId))} />
                {a.candidateName}
              </label>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <TextField label="EXCO minute (optional)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. EXCO MIN 31/2026" />
            <TextField label="Approved on (optional)" type="date" value={approvedOn} onChange={(e) => setApprovedOn(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" aria-label="Signed shortlist" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: 14 }} />
            <Button onClick={attach} loading={busy} loadingText="Attaching..."><Upload size={14} /> Attach signed shortlist</Button>
          </div>
        </div>
      )}
      {data.awaiting.length > 0 && !canAttach && <p style={{ ...hintText, marginTop: 8 }}>A Senior HR Officer or above attaches the signed copy.</p>}

      {data.approvals.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <span style={sectionLabel}>Attached</span>
          {data.approvals.map((a) => (
            <div key={a.id} style={{ fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--color-border)' }}>
              <a href={fileLink(a.documentUrl)} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <FileText size={13} /> {a.documentName}
              </a>
              {a.excoReference && <> &middot; {a.excoReference}</>}
              {a.approvedOn && <> &middot; approved {new Date(a.approvedOn).toLocaleDateString()}</>}
              <div style={hintText}>
                {a.approved.length} approved{a.struckOff.length ? `, struck off: ${a.struckOff.map((s) => s.candidateName).join(', ')}` : ''}
                {' '}&middot; attached by {a.uploadedBy?.name} on {new Date(a.uploadedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
