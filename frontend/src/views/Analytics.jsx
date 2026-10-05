import React, { useCallback, useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';
import { useDashboardEvents } from '../models/dashboardSocket';
import Card from '../components/Card';
import Alert from '../components/Alert';
import { STATUS_COLORS } from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import MonthlyMetricChart from '../components/charts/MonthlyMetricChart';
import MonthlyStackedBarChart from '../components/charts/MonthlyStackedBarChart';
import { CHART_SERIES } from '../theme/chartPalette';
import { debounce } from '../utils/debounce';


// SLA compliance reads green/amber/red against the same duration-based
// urgency semantics as FollowUpsPanel/ApprovalsCenter's badges, just at
// the aggregate level rather than per-task.
const COMPLIANCE_THRESHOLDS = [
  { min: 80, color: 'var(--color-accent)' },
  { min: 50, color: 'var(--color-warning)' },
  { min: 0, color: 'var(--color-danger)' }
];

// Shared by the three small panel-list cards below (turnaround, delegation
// activity, panel workload) - all three render the same two-line-per-row
// shape, so one skeleton mimics all of them rather than a plain "Loading…"
// string per card. See Skeleton.jsx's own comment for why.
function PanelRowsSkeleton() {
  return (
    <div>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
          <Skeleton width={`${55 - i * 8}%`} height={13} style={{ marginBottom: 6 }} />
          <Skeleton width="30%" height={11} />
        </div>
      ))}
    </div>
  );
}

function ApprovalTurnaroundTable({ rows, loading }) {
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Approval turnaround by approver
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No resolved approvals yet.</p>
      ) : (
        <div className="panel-scroll">
          {rows.map((r, i) => (
            <div key={r.approver} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0',
              borderTop: i > 0 ? '1px solid var(--color-border)' : 'none'
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.approver}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.count} decision{r.count === 1 ? '' : 's'}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                {r.avgHours >= 24 ? `${(r.avgHours / 24).toFixed(1)}d` : `${r.avgHours}h`} avg
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DelegationActivityList({ rows, loading }) {
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Recent delegation activity
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No delegated actions on record yet.</p>
      ) : (
        <div className="panel-scroll">
          {rows.map((r, i) => (
            <div key={r.id} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
              <div style={{ fontSize: 13 }}>
                <strong>{r.delegateName}</strong> acted for <strong>{r.delegatorName}</strong>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {r.action} &middot; {new Date(r.usedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PanelWorkloadTable({ rows, loading }) {
  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Panel workload
      </div>
      {loading ? (
        <PanelRowsSkeleton />
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No interviews held yet.</p>
      ) : (
        <div className="panel-scroll">
          {rows.map((r, i) => (
            <div key={r.name} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0',
              borderTop: i > 0 ? '1px solid var(--color-border)' : 'none'
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {r.interviews} interview{r.interviews === 1 ? '' : 's'}{r.chaired ? <> &middot; chaired {r.chaired}</> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const OFFER_OUTCOME_SERIES = [
  { key: 'Accepted', label: 'Accepted', color: STATUS_COLORS.Accepted },
  { key: 'Declined', label: 'Declined', color: STATUS_COLORS.Declined }
];
const HIRING_MIX_SERIES = [
  { key: 'Internal', label: 'Internal', color: CHART_SERIES[0] },
  { key: 'External', label: 'External', color: CHART_SERIES[1] }
];

// The trend charts under the Dashboard's figures (RecruitmentDashboard.jsx):
// SLA compliance, time to fill, offer outcomes, hiring mix, approval
// turnaround, panel workload and delegation activity. Manager+ only, the
// same tier as the endpoints it reads.
export default function AnalyticsTrends() {
  const [slaCompliance, setSlaCompliance] = useState([]);
  const [approvalTurnaround, setApprovalTurnaround] = useState([]);
  const [offerOutcomes, setOfferOutcomes] = useState([]);
  const [hiringMix, setHiringMix] = useState([]);
  const [timeToFill, setTimeToFill] = useState(null);
  const [delegationActivity, setDelegationActivity] = useState([]);
  const [panelWorkload, setPanelWorkload] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(() => {
    Promise.all([
      staffClient.get('/api/analytics/sla-compliance'),
      staffClient.get('/api/analytics/approval-turnaround'),
      staffClient.get('/api/analytics/offer-outcomes'),
      staffClient.get('/api/analytics/hiring-mix'),
      staffClient.get('/api/analytics/time-to-fill'),
      staffClient.get('/api/analytics/delegation-activity'),
      staffClient.get('/api/analytics/panel-workload')
    ])
      .then(([sla, turnaround, offers, mix, fill, delegation, panel]) => {
        setSlaCompliance(sla.data);
        setApprovalTurnaround(turnaround.data);
        setOfferOutcomes(offers.data);
        setHiringMix(mix.data);
        setTimeToFill(fill.data);
        setDelegationActivity(delegation.data);
        setPanelWorkload(panel.data);
      })
      .catch((err) => setError(err.response?.data?.error || 'Could not load the trends'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  const refetchAll = useCallback(debounce(loadAll, 500), [loadAll]);
  useDashboardEvents(refetchAll);

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)' };
  return (
    <section className="ws-group">
      <h3>Trends over the last six months</h3>
      <Alert type="error" message={error} />
      <div style={grid}>
        <MonthlyMetricChart
          title="SLA compliance rate" data={slaCompliance} dataKey="complianceRate" loading={loading}
          formatValue={(v) => v + '%'} thresholds={COMPLIANCE_THRESHOLDS}
          emptyText="No resolved approvals in this window yet."
        />
        <MonthlyMetricChart
          title="Time to fill (approval to filled)" data={timeToFill?.trend || []} dataKey="avgDays" loading={loading}
          formatValue={(v) => v + ' days'}
          emptyText="No vacancies filled in this window yet."
        />
      </div>
      <div style={grid}>
        <MonthlyStackedBarChart title="Offer outcomes" data={offerOutcomes} series={OFFER_OUTCOME_SERIES} loading={loading} emptyText="No offers decided in this window yet." />
        <MonthlyStackedBarChart title="Hiring mix" data={hiringMix} series={HIRING_MIX_SERIES} loading={loading} emptyText="No vacancies filled in this window yet." />
      </div>
      <div style={grid}>
        <ApprovalTurnaroundTable rows={approvalTurnaround} loading={loading} />
        <PanelWorkloadTable rows={panelWorkload} loading={loading} />
      </div>
      <div style={{ ...grid, marginBottom: 0 }}>
        <DelegationActivityList rows={delegationActivity} loading={loading} />
      </div>
    </section>
  );
}
