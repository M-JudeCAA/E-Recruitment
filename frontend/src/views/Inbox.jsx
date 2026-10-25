import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Briefcase, CalendarClock, Send, Users } from 'lucide-react';
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
import DonutChart from '../components/charts/DonutChart';
import BarList from '../components/charts/BarList';
import { STATUS_FILL } from '../theme/chartPalette';
import { countByStage } from '../utils/vacancyStages';
import { debounce } from '../utils/debounce';

// The landing page for every staff role: one list of what is waiting for
// this person, overdue first (backend inboxService), replacing HR Home,
// Executive Overview and the Approvals Center. "Review" opens an approval in
// a side panel with the decision at the bottom; "Open" goes to the vacancy
// tab (or page) where the step is taken. A red edge marks only overdue work.
//
// /hr/inbox?item=<key> - where an approval notice leads (backend
// utils/notificationLinks.js) - opens that item straight away: its review
// panel, or its page. When it is no longer waiting for this person (someone
// else dealt with it), the page says so and offers `fallback`.

const GROUPS = [['overdue', 'Overdue'], ['week', 'Due this week'], ['later', 'Later']];
const GROUP_COLORS = { overdue: STATUS_FILL.bad, week: STATUS_FILL.waiting, later: STATUS_FILL.info };

// The four figures from the API (inboxService), in its order, each given a
// colour, an icon and the page that lists what it counts.
const FIGURE_LOOKS = [
  { tone: 'brand', icon: Briefcase, to: '/hr' },
  { tone: 'violet', icon: CalendarClock, to: '/hr/interviews' },
  { tone: 'warn', icon: Send, to: '/hr/offers' },
  { tone: 'ok', icon: Users, to: '/hr/candidates?view=applications' }
];

// The charts under the figures: this person's work by urgency, every
// vacancy by stage (a slice opens the Vacancies list at that stage) and the
// live vacancies drawing the most applicants (a bar opens the vacancy).
function InboxCharts({ items, showVacancies }) {
  const navigate = useNavigate();
  const [vacancies, setVacancies] = useState(null);
  useEffect(() => {
    if (!showVacancies) return;
    staffClient.get('/api/vacancies/admin').then((r) => setVacancies(r.data)).catch(() => setVacancies([]));
  }, [showVacancies]);

  const work = GROUPS.map(([key, label]) => ({ key, label, color: GROUP_COLORS[key], value: items.filter((i) => i.group === key && !i.info).length }));
  const jump = (d) => document.getElementById(`inbox-${d.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const live = (vacancies || []).filter((v) => ['Open', 'PartiallyFilled'].includes(v.status));
  const busiest = live
    .map((v) => ({ key: v.id, label: v.title, note: v.jobRef?.replace('UCAA/ADV/', ''), value: v._count?.applications ?? 0 }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  return (
    <div className="ws-charts">
      <Panel title="Your work" note="What is waiting for you, by when it is due">
        <DonutChart data={work} centerLabel="waiting" onSelect={jump} emptyText="Nothing waiting for you." />
      </Panel>
      {showVacancies && (
        <Panel title="Vacancies by stage" note="Click a stage to see its vacancies">
          {vacancies ? <DonutChart data={countByStage(vacancies)} centerLabel="vacancies" emptyText="No vacancies yet."
            onSelect={(d) => navigate(`/hr?stage=${d.key}`)} /> : <Skeleton height={168} />}
        </Panel>
      )}
      {showVacancies && (
        <Panel title="Most applicants" note="Open vacancies with the most applications">
          {vacancies ? <BarList rows={busiest} emptyText="No open vacancies." color={STATUS_FILL.info}
            onSelect={(r) => navigate(`/hr/vacancy/${r.key}?tab=applicants`)} /> : <Skeleton height={168} />}
        </Panel>
      )}
    </div>
  );
}

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
  const [params, setParams] = useSearchParams();
  const [gone, setGone] = useState(null); // { fallback } for an item no longer here

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

  // Opening the item a notification pointed at, once the list is in.
  const wanted = params.get('item');
  useEffect(() => {
    if (!wanted || !inbox) return;
    const item = (inbox.items || []).find((i) => i.key === wanted);
    const fallback = params.get('fallback');
    setParams({}, { replace: true });
    // Only a page of this app: "/hr", "/hr/..." or "/hr?...", with no
    // backslash (which some routers read as "//", another site).
    const safeFallback = fallback && /^\/hr(?:[/?#]|$)/.test(fallback) && !fallback.includes('\\') ? fallback : null;
    if (item) { setGone(null); open(item); } else setGone({ fallback: safeFallback });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, inbox]);

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
        {gone && (
          <div className="ws-panel" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
            <span style={{ fontSize: 14 }}>That request is no longer waiting for you - someone may have dealt with it already.</span>
            <span style={{ display: 'flex', gap: 8 }}>
              {gone.fallback && <Button variant="secondary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => navigate(gone.fallback)}>Open it</Button>}
              <Button variant="ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => setGone(null)}>Dismiss</Button>
            </span>
          </div>
        )}

        {inbox ? <Figures figures={inbox.figures.map((f, i) => ({ ...FIGURE_LOOKS[i], ...f }))} /> : <Skeleton height={76} />}

        {inbox && <InboxCharts items={items} showVacancies={rankOf(staff?.role) > 0} />}

        {!inbox && <Panel><Skeleton width="60%" height={14} style={{ marginBottom: 10 }} /><Skeleton width="40%" height={12} /></Panel>}

        {inbox && items.length === 0 && (
          <div className="ws-panel ws-empty">You are all caught up. New work appears here as soon as it is yours to do.</div>
        )}

        {grouped.map(([key, label, list]) => list.length > 0 && (
          <section key={key} id={`inbox-${key}`} className="ws-group" style={{ scrollMarginTop: 'calc(var(--navbar-height) + 16px)' }}>
            <h3 className={key}>{label} <span style={{ fontWeight: 500 }}>· {list.length}</span></h3>
            <div className="ws-panel">
              {list.map((item) => (
                <div key={item.key} className={`ws-task${item.overdue ? ' over' : key === 'week' ? ' soon' : ' later'}`}>
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
