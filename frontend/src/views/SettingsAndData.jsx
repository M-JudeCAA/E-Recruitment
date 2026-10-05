import React, { useCallback, useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import TextField from '../components/TextField';
import TextArea from '../components/TextArea';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';

// Settings (a system administrator or HR Manager+) and candidates' data:
// erasure requests to complete or refuse, and the log of every erasure
// (HR Manager+ only - a system administrator doesn't see candidate data).
// Backend: settingsController, dataProtectionController.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

function SettingRow({ setting, onSaved }) {
  const [value, setValue] = useState(String(setting.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValue(String(setting.value)); }, [setting.value]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      onSaved((await staffClient.put(`/api/settings/${setting.key}`, { value: Number(value) })).data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 200 }}>
          <TextField label={setting.label} type="number" min={setting.min} max={setting.max} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button onClick={save} loading={busy} disabled={String(setting.value) === value} style={{ marginBottom: 'var(--spacing-md)' }}><Save size={14} /> Save</Button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {setting.help} Allowed: {setting.min}-{setting.max}; default {setting.default}.
        {setting.updatedBy && ` Last changed by ${setting.updatedBy.name} on ${new Date(setting.updatedAt).toLocaleDateString()}.`}
      </div>
      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</div>}
    </div>
  );
}

export default function SettingsAndData() {
  const { staff } = useAuth();
  const isManager = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  const confirm = useConfirm();
  const [settingsList, setSettingsList] = useState(null);
  const [requests, setRequests] = useState([]);
  const [purges, setPurges] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refusing, setRefusing] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    staffClient.get('/api/settings').then((res) => setSettingsList(res.data)).catch((err) => setError(err.response?.data?.error || 'Could not load the settings'));
    if (isManager) {
      staffClient.get('/api/data-protection/requests').then((res) => setRequests(res.data)).catch(() => {});
      staffClient.get('/api/data-protection/purges').then((res) => setPurges(res.data)).catch(() => {});
    }
  }, [isManager]);
  useEffect(() => { load(); }, [load]);

  const complete = async (r) => {
    if (!(await confirm(`Erase ${r.candidate.fullName}'s personal data now? Their profile, documents and application details are removed and their account closed. This can't be undone.`,
      { title: 'Erase candidate data', confirmLabel: 'Erase', danger: true }))) return;
    setBusy(`c${r.id}`); setError(''); setNotice('');
    try {
      await staffClient.patch(`/api/data-protection/requests/${r.id}/complete`);
      setNotice(`${r.candidate.fullName}'s data has been erased, and they have been told by email.`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not erase the data');
    } finally {
      setBusy('');
    }
  };

  const refuse = async () => {
    setBusy('refuse'); setError('');
    try {
      await staffClient.patch(`/api/data-protection/requests/${refusing.id}/refuse`, { reason });
      setNotice('The request was refused and the candidate told why.');
      setRefusing(null); setReason('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not refuse the request');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="settings" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Settings & data" subtitle="How long data is kept, and candidates' requests about their data" />
        <Alert type="error" message={error} />
        <Alert type="success" message={notice} />

        <Card>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Data retention</h3>
          {(settingsList || []).map((s) => <SettingRow key={s.key} setting={s} onSaved={setSettingsList} />)}
        </Card>

        {isManager && (
          <>
            <Card>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, display: 'flex', gap: 6, alignItems: 'center' }}><ShieldCheck size={16} /> Erasure requests</h3>
              {requests.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No requests yet.</p>}
              {requests.map((r) => (
                <div key={r.id} style={{ padding: '10px 0', borderTop: '1px solid var(--color-border)', fontSize: 14 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{r.candidate.fullName}</strong>
                    {!r.candidate.purgedAt && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{r.candidate.email}</span>}
                    <StatusBadge status={r.status === 'Refused' ? 'Rejected' : r.status} label={r.status} />
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>asked {new Date(r.createdAt).toLocaleDateString()}</span>
                  </div>
                  {r.reason && <div style={{ fontSize: 13, fontStyle: 'italic' }}>"{r.reason}"</div>}
                  {r.candidate.applications?.length > 0 && !r.candidate.purgedAt && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      Applications: {r.candidate.applications.map((a) => `${a.vacancy.jobRef} (${a.status})`).join(', ')}
                    </div>
                  )}
                  {r.status === 'Pending' ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Button variant="danger" style={{ padding: '4px 10px', fontSize: 13 }} disabled={!!r.blocker} loading={busy === `c${r.id}`}
                        title={r.blocker || undefined} onClick={() => complete(r)}>Erase data</Button>
                      <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => { setReason(''); setRefusing(r); }}>Refuse</Button>
                      {r.blocker && <span style={{ fontSize: 12, color: 'var(--color-warning)' }}>{r.blocker}</span>}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {r.status} {r.decidedAt ? `on ${new Date(r.decidedAt).toLocaleDateString()}` : ''}{r.decidedBy ? ` by ${r.decidedBy.name}` : ''}
                      {r.decisionReason ? ` - ${r.decisionReason}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </Card>

            <Card>
              <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Erasure log</h3>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>Every candidate whose personal data was erased - on request, or by the retention schedule.</p>
              {purges.length === 0 ? <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Nothing erased yet.</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr>{['When', 'Candidate', 'Why', 'Removed'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {purges.map((p) => (
                      <tr key={p.id}>
                        <td style={{ padding: '6px 8px' }}>{new Date(p.at).toLocaleString()}</td>
                        <td style={{ padding: '6px 8px' }}>#{p.candidateId}</td>
                        <td style={{ padding: '6px 8px' }}>{p.reason === 'ErasureRequest' ? 'Candidate\'s request' : 'Retention period passed'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {[['profileEntries', 'profile entry', 'profile entries'], ['documents', 'document', 'documents'], ['files', 'file', 'files'], ['applications', 'application', 'applications']]
                            .map(([k, one, many]) => `${p.removed?.[k] ?? 0} ${(p.removed?.[k] ?? 0) === 1 ? one : many}`).join(', ')} anonymised
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}

        {refusing && (
          <Modal title={`Refuse ${refusing.candidate.fullName}'s request`} onClose={() => setRefusing(null)} footer={<>
            <Button variant="ghost" onClick={() => setRefusing(null)}>Cancel</Button>
            <Button onClick={refuse} loading={busy === 'refuse'} disabled={reason.trim().length < 10}>Refuse request</Button>
          </>}>
            <TextArea label="Reason (the candidate is told it)" required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Modal>
        )}
      </div>
    </div>
  );
}
