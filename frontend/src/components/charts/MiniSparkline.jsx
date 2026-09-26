import React from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// Small axis-less trend line for a KPI tile - e.g. HRHome's "Total
// Applications" tile getting a sense of direction, not just a static count.
export default function MiniSparkline({ data, dataKey = 'count', color = 'var(--color-primary)' }) {
  if (!data || data.length < 2) return null;

  const gradientId = `sparkline-${dataKey}`;
  return (
    <div style={{ width: 64, height: 28, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
