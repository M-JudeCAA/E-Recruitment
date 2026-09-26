import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Award, Building2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import LiveIndicator from '../components/LiveIndicator';
import Spinner from '../components/Spinner';
import Skeleton from '../components/Skeleton';
import ViewSwitcher from '../components/ViewSwitcher';
import DataTable from '../components/DataTable';
import BoardView from '../components/BoardView';
import PageControls from '../components/PageControls';
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

// Mimics a queue row's title+meta+action shape (Vacancies/Offers) while
// vacancies/offers is still null - the exact count (2) is arbitrary, just
// enough to read as "a short list is coming" without overcommitting to a
// specific number that might visibly shrink once the real data lands.
function QueueRowSkeleton() {
  return (
    <>
      {[0, 1].map((i) => (
        <Card key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <Skeleton width={220} height={15} style={{ marginBottom: 8 }} />
              <Skeleton width={320} height={12} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Skeleton width={60} height={26} radius={6} />
              <Skeleton width={80} height={26} radius={6} />
            </div>
          </div>
        </Card>
      ))}
    </>
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
  // Keyed by `${action}-${id}` - several cards render their own
  // Approve/Decline/Reject buttons at once, so a single shared flag would
  // incorrectly spin/disable every card instead of just the one clicked.
  const [busy, setBusy] = useState({});
  const [offersLoading, setOffersLoading] = useState(false);
  const [urlParams, setUrlParams] = useSearchParams();
  const [view, setView] = useState(urlParams.get('view') || 'list');
  useEffect(() => {
    const next = new URLSearchParams(urlParams);
    if (view === 'list') next.delete('view'); else next.set('view', view);
    setUrlParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const loadVacancies = useCallback(() => staffClient.get('/api/vacancies/admin')
    .then((res) => setVacancies(res.data.filter((v) => v.status === 'PendingApproval')))
    .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies')), []);
  const loadOffers = useCallback(() => {
    setOffersLoading(true);
    return staffClient.get('/api/applications/offers/pending-approval', { params: { page: offersPage, limit: OFFERS_PAGE_SIZE } })
      .then((res) => { setOffers(res.data.data); setOffersTotal(res.data.total); })
      .catch((err) => setError(err.response?.data?.error || 'Could not load offers'))
      .finally(() => setOffersLoading(false));
  }, [offersPage]);
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

  const runBusy = async (key, fn) => {
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const approveVacancy = (id) => runBusy(`vacancy-approve-${id}`, async () => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      setMessage('Vacancy approved.');
      loadVacancies();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  });

  // Declining a still-pending vacancy reuses the existing close() action -
  // the same mechanism HRDashboard already offers ("Close vacancy" is
  // available at every non-Closed status, PendingApproval included), not
  // a separate reject endpoint.
  const declineVacancy = async (id) => {
    if (!(await confirm('Decline this vacancy? It will be closed without ever opening.', { title: 'Decline vacancy', confirmLabel: 'Decline', danger: true }))) return;
    await runBusy(`vacancy-decline-${id}`, async () => {
      setError(''); setMessage('');
      try {
        await staffClient.patch(`/api/vacancies/${id}/close`);
        setMessage('Vacancy declined and closed.');
        loadVacancies();
      } catch (err) {
        setError(err.response?.data?.error || 'Could not decline vacancy');
      }
    });
  };

  const approveOffer = (id) => runBusy(`offer-approve-${id}`, async () => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/applications/offers/${id}/approve`);
      setMessage('Offer approved. The candidate has been notified.');
      loadOffers();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  });

  const approveDepartment = (id) => runBusy(`dept-approve-${id}`, async () => {
    setError(''); setMessage('');
    try {
      await staffClient.patch(`/api/departments/${id}/approve`);
      setMessage('Department approved.');
      loadDepartments();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  });

  const rejectDepartment = (id) => runBusy(`dept-reject-${id}`, async () => {
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
  });

  const loading = vacancies === null || offers === null || departments === null;
  const totalPending = (vacancies?.length || 0) + offersTotal + (departments?.length || 0);
  const offersTotalPages = Math.max(Math.ceil(offersTotal / OFFERS_PAGE_SIZE), 1);

  // Board view here groups by urgency, not status - every item in this
  // page is already the same status (PendingApproval, or an offer at
  // Recommended), so a status board would be one crowded column. Urgency
  // is the dimension that actually varies and that HR cares about here.
  const URGENCY_COLUMNS = [
    { key: 'overdue', label: 'Overdue', color: 'var(--color-danger)' },
    { key: 'due-soon', label: 'Due soon', color: 'var(--color-warning)' },
    { key: 'on-track', label: 'On track', color: 'var(--color-accent)' },
    { key: 'not-tracked', label: 'Not tracked', color: 'var(--color-text-muted)' }
  ];
  const urgencyTier = (taskType, id) => urgencyOf(followUpFor(taskType, id))?.tier || 'not-tracked';

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <LiveIndicator connected={connected} />
              <ViewSwitcher view={view} onChange={setView} />
            </div>
          </div>

          <Alert type="success" message={message} />
          <Alert type="error" message={error} />

          <SectionHeader icon={Briefcase} title="Vacancies" count={vacancies?.length ?? '—'} />
          {vacancies === null && <QueueRowSkeleton />}
          {sortedVacancies?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No vacancies awaiting approval.</p></Card>
          )}
          {sortedVacancies?.length > 0 && view === 'table' && (
            <Card style={{ padding: 0, marginBottom: 'var(--spacing-lg)' }}>
              <DataTable
                getRowKey={(v) => v.id}
                rows={sortedVacancies}
                columns={[
                  { key: 'title', label: 'Title', render: (v) => <span style={{ fontWeight: 600 }}>{v.title}</span> },
                  { key: 'dept', label: 'Department', render: (v) => `${v.department?.directorate?.name} — ${v.department?.name}` },
                  { key: 'type', label: 'Type', render: (v) => v.postingType },
                  { key: 'urgency', label: 'Urgency', render: (v) => <UrgencyBadge followUp={followUpFor('VacancyApproval', v.id)} /> },
                  {
                    key: 'actions', label: '', align: 'right', render: (v) => (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Link to={`/hr/vacancy/${v.id}`} style={{ fontSize: 12 }}>View</Link>
                        <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--color-danger)' }} disabled={!!busy[`vacancy-approve-${v.id}`]}
                          loading={!!busy[`vacancy-decline-${v.id}`]} loadingText="…" onClick={() => declineVacancy(v.id)}>Decline</Button>
                        <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 12 }} disabled={!!busy[`vacancy-decline-${v.id}`]}
                          loading={!!busy[`vacancy-approve-${v.id}`]} loadingText="…" onClick={() => approveVacancy(v.id)}>Approve</Button>
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          )}
          {sortedVacancies?.length > 0 && view === 'board' && (
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
              <BoardView
                getItemKey={(v) => v.id}
                items={sortedVacancies}
                columns={URGENCY_COLUMNS}
                groupBy={(v) => urgencyTier('VacancyApproval', v.id)}
                renderCard={(v) => (
                  <Card style={{ marginBottom: 0, padding: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{v.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{v.jobRef} &middot; {v.postingType}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={!!busy[`vacancy-decline-${v.id}`]}
                        loading={!!busy[`vacancy-approve-${v.id}`]} loadingText="…" onClick={() => approveVacancy(v.id)}>Approve</Button>
                      <Link to={`/hr/vacancy/${v.id}`} style={{ fontSize: 11, alignSelf: 'center' }}>View</Link>
                    </div>
                  </Card>
                )}
              />
            </div>
          )}
          {sortedVacancies?.length > 0 && view !== 'table' && view !== 'board' && sortedVacancies.map((v) => (
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
                  <Button variant="ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)' }} disabled={!!busy[`vacancy-approve-${v.id}`]}
                    loading={!!busy[`vacancy-decline-${v.id}`]} loadingText="Declining..." onClick={() => declineVacancy(v.id)}>Decline</Button>
                  <Button variant="secondary" style={{ padding: '4px 10px' }} disabled={!!busy[`vacancy-decline-${v.id}`]}
                    loading={!!busy[`vacancy-approve-${v.id}`]} loadingText="Approving..." onClick={() => approveVacancy(v.id)}>Approve</Button>
                </div>
              </div>
            </Card>
          ))}

          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <SectionHeader icon={Award} title="Offers" count={offersTotal ?? '—'} />
          </div>
          {offers === null && <QueueRowSkeleton />}
          {offers?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No offers awaiting approval.</p></Card>
          )}
          {offers?.length > 0 && view === 'table' && (
            <Card style={{ padding: 0 }}>
              <DataTable
                getRowKey={(o) => o.id}
                rows={offers}
                columns={[
                  { key: 'candidate', label: 'Candidate', render: (o) => <span style={{ fontWeight: 600 }}>{o.application.candidate.fullName}</span> },
                  { key: 'vacancy', label: 'Vacancy', render: (o) => `${o.application.vacancy.jobRef} — ${o.application.vacancy.title}` },
                  { key: 'by', label: 'Recommended by', render: (o) => o.recommendedBy?.name || 'HR' },
                  { key: 'urgency', label: 'Urgency', render: (o) => <UrgencyBadge followUp={followUpFor('OfferApproval', o.id)} /> },
                  {
                    key: 'actions', label: '', align: 'right', render: (o) => (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Link to={`/hr/vacancy/${o.application.vacancy.id}`} style={{ fontSize: 12 }}>View</Link>
                        <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 12 }}
                          loading={!!busy[`offer-approve-${o.id}`]} loadingText="…" onClick={() => approveOffer(o.id)}>Approve</Button>
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          )}
          {offers?.length > 0 && view === 'board' && (
            <BoardView
              getItemKey={(o) => o.id}
              items={offers}
              columns={URGENCY_COLUMNS}
              groupBy={(o) => urgencyTier('OfferApproval', o.id)}
              renderCard={(o) => (
                <Card style={{ marginBottom: 0, padding: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{o.application.candidate.fullName}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{o.application.vacancy.jobRef} &middot; {o.application.vacancy.title}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 11 }}
                      loading={!!busy[`offer-approve-${o.id}`]} loadingText="…" onClick={() => approveOffer(o.id)}>Approve</Button>
                    <Link to={`/hr/vacancy/${o.application.vacancy.id}`} style={{ fontSize: 11, alignSelf: 'center' }}>View</Link>
                  </div>
                </Card>
              )}
            />
          )}
          {offers?.length > 0 && view !== 'table' && view !== 'board' && offers.map((o) => (
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
                  <Button variant="secondary" style={{ padding: '4px 10px' }}
                    loading={!!busy[`offer-approve-${o.id}`]} loadingText="Approving..." onClick={() => approveOffer(o.id)}>Approve</Button>
                </div>
              </div>
            </Card>
          ))}
          <PageControls page={offersPage} totalPages={offersTotalPages} loading={offersLoading} onPrev={() => setOffersPage((p) => p - 1)} onNext={() => setOffersPage((p) => p + 1)} />

          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <SectionHeader icon={Building2} title="Departments" count={departments?.length ?? '—'} />
          </div>
          {departments === null && [0, 1].map((i) => (
            <Card key={i}>
              <Skeleton width={240} height={15} style={{ marginBottom: 10 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Skeleton width={80} height={24} radius={6} />
                <Skeleton width="100%" height={24} radius={6} style={{ flex: 1 }} />
                <Skeleton width={70} height={24} radius={6} />
              </div>
            </Card>
          ))}
          {departments?.length === 0 && (
            <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No departments awaiting approval.</p></Card>
          )}
          {sortedDepartments?.length > 0 && view === 'table' && (
            <Card style={{ padding: 0 }}>
              <DataTable
                getRowKey={(d) => d.id}
                rows={sortedDepartments}
                columns={[
                  { key: 'name', label: 'Department', render: (d) => <span style={{ fontWeight: 600 }}>{d.directorate.name} — {d.name}</span> },
                  { key: 'by', label: 'Proposed by', render: (d) => d.createdBy?.name || '—' },
                  { key: 'urgency', label: 'Urgency', render: (d) => <UrgencyBadge followUp={followUpFor('DepartmentApproval', d.id)} /> },
                  {
                    key: 'actions', label: '', align: 'right', render: (d) => (
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--color-danger)' }} onClick={() => setView('list')}>Reject…</Button>
                        <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 12 }} disabled={!!busy[`dept-reject-${d.id}`]}
                          loading={!!busy[`dept-approve-${d.id}`]} loadingText="…" onClick={() => approveDepartment(d.id)}>Approve</Button>
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          )}
          {sortedDepartments?.length > 0 && view === 'board' && (
            <BoardView
              getItemKey={(d) => d.id}
              items={sortedDepartments}
              columns={URGENCY_COLUMNS}
              groupBy={(d) => urgencyTier('DepartmentApproval', d.id)}
              renderCard={(d) => (
                <Card style={{ marginBottom: 0, padding: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{d.directorate.name} &mdash; {d.name}</div>
                  {d.createdBy?.name && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <Button variant="secondary" style={{ padding: '2px 8px', fontSize: 11 }} disabled={!!busy[`dept-reject-${d.id}`]}
                      loading={!!busy[`dept-approve-${d.id}`]} loadingText="…" onClick={() => approveDepartment(d.id)}>Approve</Button>
                    <Button variant="ghost" style={{ padding: '2px 8px', fontSize: 11, color: 'var(--color-danger)' }} onClick={() => setView('list')}>Reject…</Button>
                  </div>
                </Card>
              )}
            />
          )}
          {sortedDepartments?.length > 0 && view !== 'table' && view !== 'board' && sortedDepartments.map((d) => (
            <Card key={d.id}>
              <strong>{d.directorate.name} &mdash; {d.name}</strong> <StatusBadge status={d.status} />
              {' '}<UrgencyBadge followUp={followUpFor('DepartmentApproval', d.id)} />
              {d.createdBy?.name && <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--color-text-muted)' }}>proposed by {d.createdBy.name}</span>}
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <Button style={{ padding: '2px 10px' }} disabled={!!busy[`dept-reject-${d.id}`]}
                  loading={!!busy[`dept-approve-${d.id}`]} loadingText="Approving..." onClick={() => approveDepartment(d.id)}>Approve</Button>
                <input
                  placeholder="Rejection reason"
                  value={rejectReason[d.id] || ''}
                  onChange={(e) => setRejectReason({ ...rejectReason, [d.id]: e.target.value })}
                  style={{ flex: '1 1 220px', padding: 8, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}
                />
                <Button variant="ghost" style={{ padding: '2px 10px', color: 'var(--color-danger)' }} disabled={!!busy[`dept-approve-${d.id}`]}
                  loading={!!busy[`dept-reject-${d.id}`]} loadingText="Rejecting..." onClick={() => rejectDepartment(d.id)}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
