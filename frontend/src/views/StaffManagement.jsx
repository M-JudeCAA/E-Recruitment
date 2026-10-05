import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Share2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import TextArea from '../components/TextArea';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import ViewSwitcher from '../components/ViewSwitcher';
import DataTable from '../components/DataTable';
import BoardView from '../components/BoardView';
import LoadMoreControl from '../components/LoadMoreControl';

const PAGE_SIZE = 10;

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const ROLE_BY_RANK = Object.fromEntries(Object.entries(ROLE_RANK).map(([role, rank]) => [rank, role]));

const emptyDelegationForm = { delegateId: '', startDate: '', endDate: '', reason: '' };

// The role exactly one tier below the given one, or null (matches
// delegationController.js's tierBelow - an HR Officer has nobody below
// them, which is why the Delegations section is gated to Senior HR
// Officer+ same as before).
function tierBelow(role) {
  return ROLE_BY_RANK[(ROLE_RANK[role] || 0) - 1] || null;
}

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString();
}

// Active/Upcoming/Expired - a finer-grained read than the plain Open/Closed
// StatusBadge already shown per-row, used only for the Board view's columns
// (an "Upcoming" delegation is still technically not-yet-Open, but grouping
// it with every past, Closed one would bury it).
function delegationPhase(d) {
  const now = new Date();
  if (new Date(d.startDate) > now) return 'Upcoming';
  if (new Date(d.endDate) < now) return 'Expired';
  return 'Active';
}

// Unchanged from the old standalone DelegationAdmin page other than
// living as a section here - still Senior HR Officer+, the minimum tier
// that can reach this page at all (see App.jsx's route guard), so no
// further role gate is needed within the section itself.
function DelegationsSection({ view }) {
  const { staff } = useAuth();
  const delegateRole = tierBelow(staff?.role);
  // Principal HR Officer+ gets the full cross-team history from the
  // API; everyone else only ever receives their own delegations - the
  // heading just reflects what the backend already scoped.
  const isOversight = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer;

  const [staffList, setStaffList] = useState([]);
  const [delegations, setDelegations] = useState([]);
  const [loadingDelegations, setLoadingDelegations] = useState(true);
  const [form, setForm] = useState(emptyDelegationForm);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadStaffList = () => staffClient.get('/api/staff-users')
    .then((res) => setStaffList(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load staff'));
  const loadDelegations = () => staffClient.get('/api/delegations')
    .then((res) => setDelegations(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load delegations'))
    .finally(() => setLoadingDelegations(false));

  useEffect(() => {
    loadStaffList();
    loadDelegations();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setMessage(''); setError(''); setCreating(true);
    try {
      await staffClient.post('/api/delegations', form);
      setMessage('Delegation created.');
      setForm(emptyDelegationForm);
      loadDelegations();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create delegation');
    } finally {
      setCreating(false);
    }
  };

  const eligibleDelegates = staffList.filter((s) => s.role === delegateRole);

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--spacing-md)' }}>
        <Share2 size={18} color="var(--color-primary)" />
        <h3 style={{ margin: 0 }}>Delegations</h3>
      </div>

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      <Card accent="var(--color-primary)">
        <h4 style={{ marginTop: 0 }}>Delegate your authority</h4>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          While active, the person you choose can act with your permissions in addition to their own - you
          do not lose access yourself. You can only delegate to a {delegateRole ? delegateRole.replace(/_/g, ' ') : '(no eligible tier)'}.
        </p>
        <form onSubmit={submit}>
          <Select label="Delegate to" value={form.delegateId}
            onChange={(e) => setForm({ ...form, delegateId: e.target.value })} required>
            <option value="">Select a staff member</option>
            {eligibleDelegates.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <TextField label="Start date" type="date" value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
          <TextField label="End date" type="date" value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
          <TextArea label="Reason" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit" loading={creating} loadingText="Creating...">Create delegation</Button>
        </form>
      </Card>

      <h4>{isOversight ? 'All delegations' : 'My delegations'}</h4>
      {loadingDelegations ? (
        [0, 1].map((i) => (
          <Card key={i}>
            <Skeleton width="55%" height={14} style={{ marginBottom: 8 }} />
            <Skeleton width="40%" height={12} />
          </Card>
        ))
      ) : delegations.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No delegations found.</p>
      ) : view === 'table' ? (
        <>
          <Card style={{ padding: 0 }}>
            <DataTable
              getRowKey={(d) => d.id}
              rows={delegations.slice(0, visibleCount)}
              columns={[
                { key: 'delegate', label: 'Delegate', render: (d) => <span style={{ fontWeight: 600 }}>{d.delegate.name}</span> },
                { key: 'delegator', label: 'Acting for', render: (d) => d.delegator.name },
                { key: 'period', label: 'Period', render: (d) => `${fmt(d.startDate)} – ${fmt(d.endDate)}` },
                {
                  key: 'status', label: 'Status', render: (d) => {
                    const active = new Date(d.startDate) <= new Date() && new Date() <= new Date(d.endDate);
                    return <StatusBadge status={active ? 'Open' : 'Closed'} />;
                  }
                },
                { key: 'reason', label: 'Reason', render: (d) => d.reason }
              ]}
            />
          </Card>
          <LoadMoreControl total={delegations.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)} />
        </>
      ) : view === 'board' ? (
        <>
          <BoardView
            getItemKey={(d) => d.id}
            items={delegations.slice(0, visibleCount)}
            groupBy={delegationPhase}
            columns={[
              { key: 'Active', label: 'Active', color: 'var(--color-accent)' },
              { key: 'Upcoming', label: 'Upcoming', color: 'var(--color-warning)' },
              { key: 'Expired', label: 'Expired', color: 'var(--color-text-muted)' }
            ]}
            renderCard={(d) => (
              <Card style={{ marginBottom: 0, padding: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{d.delegate.name} &rarr; {d.delegator.name}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{fmt(d.startDate)} – {fmt(d.endDate)}</div>
              </Card>
            )}
          />
          <LoadMoreControl total={delegations.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)} />
        </>
      ) : (
        <>
          {delegations.slice(0, visibleCount).map((d) => {
            const active = new Date(d.startDate) <= new Date() && new Date() <= new Date(d.endDate);
            return (
              <Card key={d.id}>
                <strong>{d.delegate.name}</strong> acting for <strong>{d.delegator.name}</strong>{' '}
                <StatusBadge status={active ? 'Open' : 'Closed'} />
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  {fmt(d.startDate)} &ndash; {fmt(d.endDate)} &middot; {d.reason}
                </div>
              </Card>
            );
          })}
          <LoadMoreControl total={delegations.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount((c) => c + PAGE_SIZE)} />
        </>
      )}
    </section>
  );
}

// Delegated authority (Senior HR Officer+, see App.jsx). Staff accounts
// used to live here too; they are now a system administrator's job, on
// their own page (StaffAccounts.jsx).
export default function StaffManagement() {

  const [urlParams, setUrlParams] = useSearchParams();
  const [view, setView] = useState(urlParams.get('view') || 'list');
  useEffect(() => {
    const next = new URLSearchParams(urlParams);
    if (view === 'list') next.delete('view'); else next.set('view', view);
    setUrlParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="staff-management" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <PageHeader title="Delegations" subtitle="Delegated authority" />
            <ViewSwitcher view={view} onChange={setView} />
          </div>

          <DelegationsSection view={view} />
        </div>
      </div>
    </div>
  );
}
