import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Award, Building2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import LiveIndicator from '../components/LiveIndicator';
import { useConfirm } from '../components/ConfirmDialog';
import { urgencyOf } from '../utils/slaUrgency';
import { debounce } from '../utils/debounce';

const MS_PER_DAY = 86400000;

function waitingSince(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

// Small pill next to each queue row - looked up from the /follow-ups
// payload by taskType+taskId (see followUpFor below). Falls back to
// nothing rendered rather than a placeholder when the SLA lookup hasn't
// loaded yet or a policy genuinely doesn't cover this taskType/tier.
function UrgencyBadge({ followUp }) {
  const urgency = urgencyOf(followUp);
  if (!urgency) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700,
      color: urgency.color, whiteSpace: 'nowrap'
    }}>
      {urgency.label}
    </span>
  );
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
const OFFERS_PAGE_SIZE = 10;

export default function ApprovalsCenter() {
  const confirm = useConfirm();
  const [vacancies, setVacancies] = useState(null);
  // Offers is paginated (GET /api/applications/offers/pending-approval now
  // returns { data, total, page, limit }, not a bare array) - the backlog
  // can grow unbounded, unlike vacancies/departments pending approval which
  // stay small in practice.
  const [offers, setOffers] = useState(null);
  const [offersTotal, setOffersTotal] = useState(0);
  const [offersPage, setOffersPage] = useState(1);
  const [departments, setDepartments] = useState(null);
  const [followUps, setFollowUps] = useState([]);
  const [rejectReason, setRejectReason] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadVacancies = useCallback(() => staffClient.get('/api/vacancies/admin')
    .then((res) => setVacancies(res.data.filter((v) => v.status === 'PendingApproval')))
    .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies')), []);
  const loadOffers = useCallback(() => staffClient.get('/api/applications/offers/pending-approval', { params: { page: offersPage, limit: OFFERS_PAGE_SIZE } })
    .then((res) => { setOffers(res.data.data); setOffersTotal(res.data.total); })
    .catch((err) => setError(err.response?.data?.error || 'Could not load offers')), [offersPage]);
  const loadDepartments = useCallback(() => staffClient.get('/api/departments/pending')
    .then((res) => setDepartments(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load departments')), []);
  // SLA status for every pending task, looked up by taskType+taskId below
  // to badge/sort each queue - fetched once per refresh alongside the
  // queues themselves rather than per-row, so a Manager with a long offer
  // backlog isn't firing one request per row.
  const loadFollowUps = useCallback(() => staffClient.get('/api/dashboard/follow-ups')
    .then((res) => setFollowUps(res.data))
    .catch(() => {}), []); // urgency badges are a nice-to-have, never worth an error banner

  useEffect(() => { loadVacancies(); loadDepartments(); loadFollowUps(); }, [loadVacancies, loadDepartments, loadFollowUps]);
  useEffect(() => { loadOffers(); }, [loadOffers]);

  // Refetches every queue plus the SLA lookup on any dashboard-relevant
  // broadcast - a newly-pending item appears, an approved/rejected one
  // disappears, without the Manager needing to manually refresh.
  const refetchAll = useCallback(debounce(() => {
    loadVacancies(); loadOffers(); loadDepartments(); loadFollowUps();
  }, 500), [loadVacancies, loadOffers, loadDepartments, loadFollowUps]);
  const { connected } = useDashboardEvents(refetchAll);

  const followUpFor = (taskType, taskId) => followUps.find((f) => f.taskType === taskType && f.taskId === taskId);
  // Overdue first, then soonest-due, matching the same ordering
  // slaStatusService.getPendingTasksWithStatus already applies server-side -
  // an item with no SLA match yet (follow-ups still loading) sorts last
  // rather than crashing on a missing lookup.
  const sortByUrgency = (items, taskType) => [...items].sort((a, b) => {
    const fa = followUpFor(taskType, a.id);
    const fb = followUpFor(taskType, b.id);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    if (fa.isOverdue !== fb.isOverdue) return fa.isOverdue ? -1 : 1;
    return fa.hoursRemaining - fb.hoursRemaining;
  });
  const sortedVacancies = vacancies ? sortByUrgency(vacancies, 'VacancyApproval') : null;
  const sortedDepartments = departments ? sortByUrgency(departments, 'DepartmentApproval') : null;
  const overdueCount = followUps.filter((f) => f.isOverdue).length;

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
  const totalPending = (vacancies?.length || 0) + offersTotal + (departments?.length || 0);
  const offersTotalPages = Math.max(Math.ceil(offersTotal / OFFERS_PAGE_SIZE), 1);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="approvals" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 'var(--spacing-lg)' }}>
            <div>
              <h2 style={{ margin: 0 }}>Approvals Center</h2>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
                {loading ? 'Loading…' : totalPending === 0 ? 'Nothing waiting on you right now.' : `${totalPending} item${totalPending === 1 ? '' : 's'} waiting on your decision${overdueCount > 0 ? `, ${overdueCount} overdue` : ''}.`}
              </p>
            </div>
            <LiveIndicator connected={connected} />
          </div>

          <Alert type="success" message={message} />
          <Alert type="error" message={error} />

          <SectionHeader icon={Briefcase} title="Vacancies" count={vacancies?.length ?? '—'} />
          {sortedVacancies?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No vacancies awaiting approval.</p></Card>
          )}
          {sortedVacancies?.map((v) => (
            <Card key={v.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {v.title}
                    <UrgencyBadge followUp={followUpFor('VacancyApproval', v.id)} />
                  </div>
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
            <SectionHeader icon={Award} title="Offers" count={offersTotal ?? '—'} />
          </div>
          {offers?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No offers awaiting approval.</p></Card>
          )}
          {offers?.map((o) => (
            <Card key={o.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {o.application.candidate.fullName}
                    <UrgencyBadge followUp={followUpFor('OfferApproval', o.id)} />
                  </div>
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
          {offersTotal > OFFERS_PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, margin: '8px 0' }}>
              <Button variant="ghost" disabled={offersPage <= 1} onClick={() => setOffersPage((p) => p - 1)}>Previous</Button>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {offersPage} of {offersTotalPages}</span>
              <Button variant="ghost" disabled={offersPage >= offersTotalPages} onClick={() => setOffersPage((p) => p + 1)}>Next</Button>
            </div>
          )}

          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <SectionHeader icon={Building2} title="Departments" count={departments?.length ?? '—'} />
          </div>
          {departments?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No departments awaiting approval.</p></Card>
          )}
          {sortedDepartments?.map((d) => (
            <Card key={d.id}>
              <strong>{d.directorate.name} &mdash; {d.name}</strong> <StatusBadge status={d.status} />
              {' '}<UrgencyBadge followUp={followUpFor('DepartmentApproval', d.id)} />
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
