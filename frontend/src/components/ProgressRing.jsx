import React from 'react';

// Generic circular progress indicator - an SVG ring with the percentage
// printed in the middle. No dependency beyond plain SVG, so it drops into
// any themed surface (colors are passed in as var(--color-*) tokens by
// the caller, never hardcoded here, to keep it theme-agnostic).
export default function ProgressRing({ percent, size = 64, strokeWidth = 6, color = 'var(--color-primary)', trackColor = 'var(--color-border)' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <span style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size / 4.2, fontWeight: 700, color: 'var(--color-text)'
      }}>
        {clamped}%
      </span>
    </div>
  );
}
