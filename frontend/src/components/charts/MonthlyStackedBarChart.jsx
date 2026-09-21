import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import Card from '../Card';
import Skeleton from '../Skeleton';
import { CHART_GRID, CHART_AXIS_TEXT } from '../../theme/chartPalette';

// Generic monthly stacked-bar chart over an arbitrary set of series -
// reused for offer-outcomes (Accepted/Declined) and hiring-mix
// (Internal/External) on the Analytics page. `series` is
// [{key, label, color}], colored explicitly by the caller (status-shaped
// series pull from STATUS_COLORS, others from the categorical palette) so
// this component stays agnostic to which palette a given series belongs to.
export default function MonthlyStackedBarChart({ title, data, series, loading, emptyText }) {
  const hasData = data && data.some((d) => series.some((s) => d[s.key] > 0));

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{title}</div>
      {loading ? (
        <Skeleton width="100%" height={220} radius={8} />
      ) : !hasData ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_GRID} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={32} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {series.map((s, i) => (
                <Bar
                  key={s.key} dataKey={s.key} name={s.label} stackId="stack" fill={s.color}
                  radius={i === series.length - 1 ? [4, 4, 0, 0] : undefined}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
