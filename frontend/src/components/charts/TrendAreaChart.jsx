import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import Card from '../Card';
import Skeleton from '../Skeleton';
import { CHART_SERIES, CHART_GRID, CHART_AXIS_TEXT } from '../../theme/chartPalette';

// Generic identity series (no existing status meaning), so this pulls from
// the categorical chart palette rather than STATUS_COLORS.
const SERIES = [
  { key: 'applicationsSubmitted', label: 'Applications submitted', color: CHART_SERIES[0] },
  { key: 'vacanciesApproved', label: 'Vacancies approved', color: CHART_SERIES[1] },
  { key: 'offersApproved', label: 'Offers approved', color: CHART_SERIES[2] }
];

const RANGE_OPTIONS = [7, 30, 90];

// GET /api/dashboard/trends returns three parallel {date, count}[] arrays,
// same dates in the same order in each - merged here into one row per date
// for Recharts, which wants one array of {date, series1, series2, ...}.
function mergeSeries(data) {
  if (!data) return [];
  return data.applicationsSubmitted.map((d, i) => ({
    date: d.date.slice(5), // MM-DD - the year is implied by "last N days"
    applicationsSubmitted: d.count,
    vacanciesApproved: data.vacanciesApproved[i]?.count || 0,
    offersApproved: data.offersApproved[i]?.count || 0
  }));
}

export default function TrendAreaChart({ data, loading, days, onDaysChange }) {
  const rows = mergeSeries(data);

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Activity trend</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              style={{
                padding: '3px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                border: '1px solid var(--color-border)',
                background: days === d ? 'var(--color-primary)' : 'transparent',
                color: days === d ? '#fff' : 'var(--color-text-muted)',
                fontWeight: days === d ? 600 : 500
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <Skeleton width="100%" height={220} radius={8} />
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`trend-grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke={CHART_GRID} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CHART_AXIS_TEXT }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.map((s) => (
                <Area
                  key={s.key} type="monotone" dataKey={s.key} name={s.label}
                  stroke={s.color} strokeWidth={2} fill={`url(#trend-grad-${s.key})`}
                  dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
