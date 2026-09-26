import React from 'react';
import Card from '../Card';
import Skeleton from '../Skeleton';
import { STATUS_COLORS } from '../StatusBadge';

// Application pipeline funnel, Submitted -> Accepted. Implemented as
// proportionally-widthed bars rather than Recharts' own FunnelChart -
// simpler to theme consistently with every other chart here (stroke/fill
// off STATUS_COLORS, no separate shape-specific styling API to fight) and
// no less informative for 5 stages.
const STAGES = [
  { key: 'Submitted', label: 'Submitted' },
  { key: 'Shortlisted', label: 'Shortlisted' },
  { key: 'Interviewed', label: 'Interviewed' },
  { key: 'Offered', label: 'Offered' },
  { key: 'Accepted', label: 'Accepted' }
];

export default function FunnelChart({ counts, loading }) {
  const first = counts[STAGES[0].key] || 0;

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>Application funnel</div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STAGES.map((stage, i) => (
            <div key={stage.key}>
              <Skeleton width={90} height={11} style={{ marginBottom: 4 }} />
              <Skeleton width={`${Math.max(90 - i * 18, 20)}%`} height={20} radius={6} />
            </div>
          ))}
        </div>
      ) : first === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No applications yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STAGES.map((stage, i) => {
            const value = counts[stage.key] || 0;
            // A non-zero stage always renders a visible sliver (min 4%),
            // even a tiny one - width 0 would look identical to "no data".
            const widthPct = value > 0 ? Math.max((value / first) * 100, 4) : 0;
            const prevValue = i > 0 ? (counts[STAGES[i - 1].key] || 0) : null;
            const conversion = prevValue ? Math.round((value / prevValue) * 100) : null;
            return (
              <div key={stage.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  <span>{stage.label}</span>
                  <span>
                    <strong style={{ color: 'var(--color-text)' }}>{value}</strong>
                    {conversion != null && ` · ${conversion}% of prior stage`}
                  </span>
                </div>
                <div style={{ height: 20, borderRadius: 6, background: 'var(--color-bg-subtle)', overflow: 'hidden' }}>
                  <div
                    title={`${stage.label}: ${value}`}
                    style={{
                      height: '100%', width: `${widthPct}%`, borderRadius: 6,
                      background: STATUS_COLORS[stage.key] || 'var(--color-primary)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
