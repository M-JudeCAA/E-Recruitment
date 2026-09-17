import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import Card from '../Card';
import Skeleton from '../Skeleton';
import { STATUS_COLORS } from '../StatusBadge';
import { CHART_GRID, CHART_AXIS_TEXT } from '../../theme/chartPalette';

// Interactive replacement for the old hand-rolled HeadcountByDirectorate -
// same stacked Open/PartiallyFilled/Filled segments, same STATUS_COLORS,
// now with a real hover tooltip and axis instead of just a title attribute.
export default function DirectorateBarChart({ rows, loading }) {
  const data = rows.slice(0, 6);

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Headcount by directorate
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Skeleton width={70} height={11} />
              <Skeleton width={`${70 - i * 12}%`} height={16} radius={4} />
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>No active vacancies yet.</p>
      ) : (
        <div style={{ width: '100%', height: Math.max(data.length * 46, 140) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid horizontal={false} stroke={CHART_GRID} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis type="category" dataKey="directorate" width={90} tick={{ fontSize: 12, fill: 'var(--color-text)' }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => value.replace(/([A-Z])/g, ' $1').trim()} />
              <Bar dataKey="Filled" stackId="hc" fill={STATUS_COLORS.Filled} isAnimationActive={false} />
              <Bar dataKey="PartiallyFilled" stackId="hc" fill={STATUS_COLORS.PartiallyFilled} isAnimationActive={false} />
              <Bar dataKey="Open" stackId="hc" fill={STATUS_COLORS.Open} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
