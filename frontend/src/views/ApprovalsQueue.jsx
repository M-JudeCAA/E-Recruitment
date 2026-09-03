import React, { useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

export default function ApprovalsQueue() {
  const { staff } = useAuth();
  const [pending, setPending] = useState([]);
  const [error, setError] = useState('');

  const load = () => staffClient.get('/api/vacancies/pending-approvals').then((res) => setPending(res.data));
  useEffect(() => { load(); }, []);

  const approve = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  const reject = async (id) => {
    const reason = window.prompt('Reason for rejecting this vacancy (optional):') || '';
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/reject`, { reason });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Rejection failed');
    }
  };

  return (
    <div>
      <PageHeader title="Pending approvals" subtitle={`Logged in as ${staff?.name} (${staff?.role?.replace(/_/g, ' ')})`} />

      <Alert type="error" message={error} />

      {pending.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No vacancies are waiting on your approval right now.</p>}

      {pending.map((v) => (
        <Card key={v.id} accent="var(--color-warning)">
          <strong>{v.title}</strong> &mdash; <StatusBadge status={v.status} />
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
            {v.department} &middot; {v.positionsRequired} position(s) &middot; {v.postingType} posting
            {v.createdBy?.name && <> &middot; submitted by {v.createdBy.name}</>}
          </div>
          <div style={{ marginTop: 8 }}>
            <Button style={{ padding: '2px 10px' }} onClick={() => approve(v.id)}>Approve</Button>
            <Button variant="secondary" style={{ marginLeft: 8, padding: '2px 10px' }} onClick={() => reject(v.id)}>Reject</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
