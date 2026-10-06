import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import { useInbox, refreshInbox } from '../models/useInbox';
import HRSidebar from '../components/HRSidebar';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import LiveIndicator from '../components/LiveIndicator';
import SystemHealthBanner from '../components/SystemHealthBanner';
import ReviewPanel from '../components/workspace/ReviewPanel';
import { PageTop, Meta, Figures, Panel, rankOf } from '../components/workspace/ui';
import { debounce } from '../utils/debounce';

// The landing page for every staff role: one list of what is waiting for
// this person, overdue first (backend inboxService), replacing HR Home,
// Executive Overview and the Approvals Center. "Review" opens an approval in
// a side panel with the decision at the bottom; "Open" goes to the vacancy
// tab (or page) where the step is taken. A red edge marks only overdue work.

const GROUPS = [['overdue', 'Overdue'], ['week', 'Due this week'], ['later', 'Later']];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function ActivityFeed() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    staffClient.get('/api/dashboard/activity').then((r) => setItems(r.data)).catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section className="ws-group">
      <h3>Recent decisions</h3>
      <Panel padded={false}>
        <table className="ws-table"><tbody>
          {items.slice(0, 6).map((a, i) => (
            <tr key={i}>
              <td className="s" style={{ width: 120, whiteSpace: 'nowrap' }}>{new Date(a.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
              <td><span className="t">{a.actor || 'Someone'}</span> {a.text}</td>
            </tr>
          ))}
        </tbody></table>
      </Panel>
    </section>
  );
}

export default function Inbox() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const inbox = useInbox();
  const [reviewing, setReviewing] = useState(null);
  const [message, setMessage] = useState('');

  const refetch = useRef(debounce(() => refreshInbox(), 500));
  const { connected } = useDashboardEvents(refetch.current);
  useEffect(() => { refreshInbox(); }, []);

  const items = inbox?.items || [];
  const actionable = items.filter((i) => !i.info);
  const overdue = actionable.filter((i) => i.overdue).length;
  const grouped = useMemo(() => GROUPS.map(([key, label]) => [key, label, items.filter((i) => i.group === key)]), [items]);

  const open = (item) => {
    if (item.review) { setReviewing(item); return; }
    if (item.link) { navigate(item.link); return; }
    if (item.vacancyId) navigate(`/hr/vacancy/${item.vacancyId}${item.tab && item.tab !== 'overview' ? `?tab=${item.tab}` : ''}`);
  };

  const done = (text) => {
    setReviewing(null);
    setMessage(text);
    refreshInbox();
  };

  const firstName = staff?.name?.split(' ')[0] || '';
  const role = staff?.role?.replace(/_/g, ' ');

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="inbox" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop
          title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
          subtitle={<Meta parts={[role, inbox ? (actionable.length
            ? <span>{actionable.length} waiting for you{overdue ? <>, <b style={{ color: 'var(--color-danger)' }}>{overdue} overdue</b></> : ''}</span>
            : 'Nothing waiting for you') : null]} />}
          actions={<LiveIndicator connected={connected} />}
        />
        <SystemHealthBanner />
        <Alert type="success" message={message} />

        {inbox ? <Figures figures={inbox.figures} /> : <Skeleton height={76} />}

        {!inbox && <Panel><Skeleton width="60%" height={14} style={{ marginBottom: 10 }} /><Skeleton width="40%" height={12} /></Panel>}

        {inbox && items.length === 0 && (
          <div className="ws-panel ws-empty">You are all caught up. New work appears here as soon as it is yours to do.</div>
        )}

        {grouped.map(([key, label, list]) => list.length > 0 && (
          <section key={key} className="ws-group">
            <h3>{label}</h3>
            <div className="ws-panel">
              {list.map((item) => (
                <div key={item.key} className={`ws-task${item.overdue ? ' over' : ''}`}>
                  <div className="kind">{item.kind}</div>
                  <div className="what">
                    <b>{item.title}</b>
                    <div>{item.context}</div>
                  </div>
                  <div className={`ws-due${item.overdue ? ' over' : item.due?.startsWith('due today') ? ' soon' : ''}`}>{item.due || item.waiting || ''}</div>
                  <Button variant={item.overdue || (!item.info && key === 'week' && item.review) ? 'primary' : 'secondary'}
                    style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => open(item)}>
                    {item.review ? 'Review' : 'Open'}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ))}

        {rankOf(staff?.role) >= 4 && <ActivityFeed />}
      </div>

      {reviewing && (
        <ReviewPanel item={reviewing} staffRole={staff?.role} onClose={() => setReviewing(null)} onDone={done} />
      )}
    </div>
  );
}
