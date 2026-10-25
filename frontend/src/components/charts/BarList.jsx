import React from 'react';
import { STATUS_FILL } from '../../theme/chartPalette';

// Horizontal bars, one per row: rows [{ key, label, value, color?, note? }],
// drawn in HTML so long labels wrap instead of being cut. Bars grow from one
// baseline with a rounded end and the value at the tip; `max` fixes the
// scale (e.g. 100 for percentages), else the largest value sets it. With
// `onSelect` a row is a button (open the vacancy, the stage).
export default function BarList({ rows, max, color = STATUS_FILL.info, formatValue = (v) => v, onSelect, emptyText = 'Nothing to show yet.' }) {
  const shown = rows.filter((r) => r.value != null);
  if (!shown.length) return <div className="chart-empty">{emptyText}</div>;
  const top = max || Math.max(...shown.map((r) => r.value), 1);
  return (
    <ul className="barlist">
      {shown.map((r) => {
        const Row = onSelect ? 'button' : 'div';
        // The value rides at the bar's tip, so the bar leaves room for it.
        const share = Math.max(0, Math.min(1, r.value / top));
        const width = `max(4px, calc((100% - 64px) * ${share}))`;
        return (
          <li key={r.key}>
            <Row type={onSelect ? 'button' : undefined} className="barlist-row" onClick={onSelect ? () => onSelect(r) : undefined}
              title={r.note ? `${r.label}: ${formatValue(r.value)} - ${r.note}` : undefined}>
              <span className="lbl">{r.label}{r.note && <small>{r.note}</small>}</span>
              <span className="track">
                <span className="fill" style={{ width, background: r.color || color }} />
                <span className="val">{formatValue(r.value)}</span>
              </span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}
