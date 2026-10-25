import React, { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

// A donut with its legend beside it: data [{ key, label, value, color }].
// The total sits in the middle; each legend row gives the count and share,
// so a slice is never told by its colour alone. Hovering a slice or a row
// lights both up and puts that slice's count in the middle; with
// `onSelect` a slice or row is a link (a filter, a page). Slices are parted
// by a 2px white gap, not outlines.
export default function DonutChart({ data, centerLabel, onSelect, emptyText = 'Nothing to show yet.', size = 168, formatValue = (v) => v }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((n, d) => n + (d.value || 0), 0);
  if (!total) return <div className="chart-empty">{emptyText}</div>;
  const shown = data.filter((d) => d.value > 0);
  const lit = (key) => hover === null || hover === key;
  const pick = (d) => onSelect && onSelect(d);
  const hovered = data.find((d) => d.key === hover);

  return (
    <div className="donut">
      <div className="donut-plot" style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" startAngle={90} endAngle={-270}
              stroke="#fff" strokeWidth={2} isAnimationActive={false}
              onMouseEnter={(_, i) => setHover(shown[i]?.key)} onMouseLeave={() => setHover(null)}
              onClick={(_, i) => pick(shown[i])} style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}>
              {shown.map((d) => <Cell key={d.key} fill={d.color} fillOpacity={lit(d.key) ? 1 : 0.3} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center" aria-hidden="true">
          {hovered ? (
            <>
              <b>{formatValue(hovered.value)}</b>
              <span>{hovered.label} · {Math.round(((hovered.value || 0) / total) * 100)}%</span>
            </>
          ) : (
            <>
              <b>{formatValue(total)}</b>
              {centerLabel && <span>{centerLabel}</span>}
            </>
          )}
        </div>
      </div>
      <ul className="chart-legend">
        {data.map((d) => {
          const Row = onSelect && d.value ? 'button' : 'div';
          return (
            <li key={d.key}>
              <Row type={Row === 'button' ? 'button' : undefined} className={`chart-legend-row${hover === d.key ? ' on' : ''}${d.value ? '' : ' zero'}`}
                onMouseEnter={() => setHover(d.key)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}
                onClick={Row === 'button' ? () => pick(d) : undefined}>
                <span className="sw" style={{ background: d.color }} />
                <span className="lbl">{d.label}</span>
                <span className="val">{formatValue(d.value)}</span>
                <span className="pct">{Math.round(((d.value || 0) / total) * 100)}%</span>
              </Row>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
