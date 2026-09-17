import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '../Card';
import Skeleton from '../Skeleton';
import { STATUS_COLORS } from '../StatusBadge';

// Interactive replacement for the old hand-rolled proportional stacked bar
// (StatusBreakdown/ProportionalBreakdown) - same {title, counts, order,
// loading, emptyText} shape as those, so it drops straight into HRHome and
// ExecutiveDashboard. Pulls colors from StatusBadge's own STATUS_COLORS,
// never the generic chart palette, so a status is the same color whether
// it's shown as a badge or a chart segment anywhere in the app.
export default function StatusDonutChart({ title, counts, order, loading, emptyText }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const present = order.filter((k) => counts[k] > 0);
  const data = present.map((k) => ({
    key: k, name: k.replace(/_/g, ' '), value: counts[k], color: STATUS_COLORS[k] || 'var(--color-text-muted)'
  }));

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{title}</div>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Skeleton width={140} height={140} radius="50%" style={{ flexShrink: 0 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} width={`${70 - i * 10}%`} height={12} />)}
          </div>
        </div>
      ) : total === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data} dataKey="value" nameKey="name"
                  innerRadius={42} outerRadius={64} paddingAngle={2}
                  stroke="var(--color-bg)" strokeWidth={2} isAnimationActive={false}
                >
                  {data.map((d) => <Cell key={d.key} fill={d.color} />)}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value, name]}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: 1 }}>
            {data.map((d) => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                {d.name} <strong style={{ color: 'var(--color-text)' }}>({d.value})</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
