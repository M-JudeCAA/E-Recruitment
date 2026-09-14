import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Award, Building2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';

const MS_PER_DAY = 86400000;

function waitingSince(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function SectionHeader({ icon: Icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-md)' }}>
      <Icon size={18} color="var(--color-primary)" />
      <h3 style={{ margin: 0 }}>{title}</h3>
      <span style={{
        fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', background: 'var(--color-bg-subtle)',
        borderRadius: 999, padding: '2px 9px'
      }}>
        {count}
      </span>
    </div>
  );
}

// Unifies the three queues only a Manager/Director can clear - vacancy
// approvals, offer approvals, department approvals - which previously
// meant checking the Vacancies tab, the Offers tab, and the Departments
// screen separately with no single "what needs me right now" view.
export default function ApprovalsCenter() {
  const confirm = useConfirm();
  const [vacancies, setVacancies] = useState(null);
  const [offers, setOffers] = useState(null);
  const [departments, setDepartments] = useState(null);
  const [rejectReason, setRejectReason] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadVacancies = () => staffClient.get('/api/vacancies/admin')
    .then((res) => setVacancies(res.data.filter((v) => v.status === 'PendingApproval')))
    .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies'));
  const loadOffers = () => staffClient.get('/api/applications/offers/pending-approval')
    .then((res) => setOffers(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load offers'));
  const loadDepartments = () => staffClient.get('/api/departments/pending')
    .then((res) => setDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load departments'));

  useEffect(() => { loadVacancies(); loadOffers(); loadDepartments(); }, []);

  const approveVacancy = async (id) => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      setMessage('Vacancy approved.');
      loadVacancies();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  // Declining a still-pending vacancy reuses the existing close() action -
  // the same mechanism HRDashboard already offers ("Close vacancy" is
  // available at every non-Closed status, PendingApproval included), not
  // a separate reject endpoint.
  const declineVacancy = async (id) => {
    if (!(await confirm('Decline this vacancy? It will be closed without ever opening.', { title: 'Decline vacancy', confirmLabel: 'Decline', danger: true }))) return;
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/close`);
      setMessage('Vacancy declined and closed.');
      loadVacancies();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not decline vacancy');
    }
  };

  const approveOffer = async (id) => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/applications/offers/${id}/approve`);
      setMessage('Offer approved. The candidate has been notified.');
      loadOffers();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  const approveDepartment = async (id) => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/departments/${id}/approve`);
      setMessage('Department approved.');
      loadDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  const rejectDepartment = async (id) => {
    setError(''); setMessage('');
    const reason = rejectReason[id];
    if (!reason || !reason.trim()) { setError('A rejection reason is required'); return; }
    try {
      await staffClient.patch(`/api/departments/${id}/reject`, { reason });
      setMessage('Department rejected.');
      loadDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reject department');
    }
  };

  const loading = vacancies === null || offers === null || departments === null;
  const totalPending = (vacancies?.length || 0) + (offers?.length || 0) + (departments?.length || 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="approvals" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 'var(--spacing-lg)' }}>
            <h2 style={{ margin: 0 }}>Approvals Center</h2>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
              {loading ? 'Loading…' : totalPending === 0 ? 'Nothing waiting on you right now.' : `${totalPending} item${totalPending === 1 ? '' : 's'} waiting on your decision.`}
            </p>
          </div>

          <Alert type="success" message={message} />
          <Alert type="error" message={error} />

          <SectionHeader icon={Briefcase} title="Vacancies" count={vacancies?.length ?? '—'} />
          {vacancies?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No vacancies awaiting approval.</p></Card>
          )}
          {vacancies?.map((v) => (
            <Card key={v.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{v.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {v.jobRef} &middot; {v.department?.directorate?.name} &mdash; {v.department?.name}
                    {' '}&middot; {v.postingType} &middot; waiting {waitingSince(v.createdAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Link to={`/hr/vacancy/${v.id}`} style={{ padding: '4px 10px', fontSize: 13 }}>View</Link>
                  <Button variant="ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)' }} onClick={() => declineVacancy(v.id)}>Decline</Button>
                  <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => approveVacancy(v.id)}>Approve</Button>
                </div>
              </div>
            </Card>
          ))}

          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <SectionHeader icon={Award} title="Offers" count={offers?.length ?? '—'} />
          </div>
          {offers?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No offers awaiting approval.</p></Card>
          )}
          {offers?.map((o) => (
            <Card key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{o.application.candidate.fullName}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {o.application.vacancy.jobRef} &middot; {o.application.vacancy.title}
                    {' '}&middot; recommended by {o.recommendedBy?.name || 'HR'}
                    {' '}&middot; waiting {waitingSince(o.recommendedDate)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <Link to={`/hr/vacancy/${o.application.vacancy.id}`} style={{ padding: '4px 10px', fontSize: 13 }}>View</Link>
                  <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => approveOffer(o.id)}>Approve</Button>
                </div>
              </div>
            </Card>
          ))}

          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <SectionHeader icon={Building2} title="Departments" count={departments?.length ?? '—'} />
          </div>
          {departments?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No departments awaiting approval.</p></Card>
          )}
          {departments?.map((d) => (
            <Card key={d.id}>
              <strong>{d.directorate.name} &mdash; {d.name}</strong> <StatusBadge status={d.status} />
              {d.createdBy?.name && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}</span>}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <Button style={{ padding: '2px 10px' }} onClick={() => approveDepartment(d.id)}>Approve</Button>
                <input
                  placeholder="Rejection reason"
                  value={rejectReason[d.id] || ''}
                  onChange={(e) => setRejectReason({ ...rejectReason, [d.id]: e.target.value })}
                  style={{ flex: '1 1 220px', padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }} onClick={() => rejectDepartment(d.id)}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
