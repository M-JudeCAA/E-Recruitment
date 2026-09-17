import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import Card from './Card';
import { urgencyOf, withLiveCountdown } from '../utils/slaUrgency';

const TIER_ICON = { overdue: AlertTriangle, 'due-soon': Clock, 'on-track': CheckCircle2 };

// Shared between HRHome (read-only visibility - `actionable={false}`) and
// ExecutiveDashboard (click-through to the record - `actionable={true}`,
// the tier that can actually act on these). Ticks its countdown every 30s
// from each item's absolute `dueAt` rather than trusting the hoursRemaining
// figure the server returned at fetch time, which goes stale immediately.
export default function FollowUpsPanel({ items, loading, actionable, emptyText = 'Nothing waiting.' }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const live = (items || []).map((item) => withLiveCountdown(item, now));

  return (
    <Card style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>Follow-ups</div>
      {loading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : live.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{emptyText}</p>
      ) : (
        <div className="panel-scroll">
          {live.map((item, i) => {
            const urgency = urgencyOf(item);
            const Icon = TIER_ICON[urgency.tier];
            const row = (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderTop: i > 0 ? '1px solid var(--color-border)' : 'none'
                }}
              >
                <Icon size={15} color={urgency.color} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.taskType.replace(/([A-Z])/g, ' $1').trim()}</div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: urgency.color, flexShrink: 0, whiteSpace: 'nowrap' }}>{urgency.label}</span>
              </div>
            );
            const key = `${item.taskType}-${item.taskId}`;
            return actionable && item.to ? (
              <Link key={key} to={item.to} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{row}</Link>
            ) : (
              <div key={key}>{row}</div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
