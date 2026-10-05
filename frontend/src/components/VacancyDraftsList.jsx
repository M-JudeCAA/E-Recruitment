import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilePen } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useConfirm } from './ConfirmDialog';
import Card from './Card';
import Button from './Button';

// The signed-in staff member's unfinished New Listing drafts
// (/api/vacancy-drafts - private to them), with Continue and Delete.
// Renders nothing when there are none.
export default function VacancyDraftsList() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    staffClient.get('/api/vacancy-drafts').then((res) => setDrafts(res.data)).catch(() => {});
  }, []);

  const remove = async (draft) => {
    const label = draft.title || 'this draft';
    if (!(await confirm(`Delete the draft for ${label}? This cannot be undone.`, { title: 'Delete draft', confirmLabel: 'Delete', danger: true }))) return;
    setError('');
    try {
      await staffClient.delete(`/api/vacancy-drafts/${draft.id}`);
      setDrafts((list) => list.filter((d) => d.id !== draft.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete the draft');
    }
  };

  if (drafts.length === 0) return null;

  return (
    <Card style={{ marginBottom: 'var(--spacing-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <FilePen size={16} color="var(--color-primary-dark)" />
        <strong style={{ fontSize: 15 }}>Your unfinished listings ({drafts.length})</strong>
      </div>
      {error && <div role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      {drafts.map((d) => (
        <div key={d.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '8px 0', borderTop: '1px solid var(--color-border)'
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.title || 'Untitled listing'}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Last saved {new Date(d.updatedAt).toLocaleString()}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)' }} onClick={() => remove(d)}>Delete</Button>
            <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => navigate(`/hr/vacancies/new?draft=${d.id}`)}>Continue</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}
