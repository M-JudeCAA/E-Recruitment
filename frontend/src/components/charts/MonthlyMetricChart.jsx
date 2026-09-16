import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ResponsiveContainer } from 'recharts';
import Card from '../Card';
import { CHART_GRID, CHART_AXIS_TEXT, CHART_SERIES } from '../../theme/chartPalette';

// Generic single-series monthly bar chart - one value per month, with an
// optional per-bar color threshold (e.g. SLA compliance: green >=80%,
// amber 50-79%, red <50%) and a custom value formatter (e.g. "82%" or
// "14.3 days"). Reused for both the SLA-compliance and time-to-fill trends
// on the Analytics page, which share this exact shape but different units.
export default function MonthlyMetricChart({ title, data, dataKey, formatValue, thresholds, emptyText, loading }) {
  const hasData = data && data.some((d) => d[dataKey] != null);

  function colorFor(value) {
    if (!thresholds || value == null) return CHART_SERIES[0];
    const hit = thresholds.find((t) => value >= t.min);
    return hit ? hit.color : thresholds[thresholds.length - 1].color;
  }

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>{title}</div>
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : !hasData ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
      ) : (
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={CHART_GRID} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                formatter={(value) => [value == null ? 'No data' : formatValue(value), title]}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }}
              />
              <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d, i) => <Cell key={i} fill={colorFor(d[dataKey])} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
