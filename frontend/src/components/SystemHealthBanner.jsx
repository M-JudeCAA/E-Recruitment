import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import staffClient from '../models/staffApiClient';

// Staff-facing warning when something that fails silently has stopped
// working: the scheduled maintenance jobs (SLA escalations, deadline
// notices, cleanups) or outgoing email. The warnings are written by
// GET /api/dashboard/system-health (backend systemHealthService), which also
// alerts Directors in-app. Renders nothing while everything is healthy, and
// degrades silently if the check itself can't be reached - it must never
// get in the way of the page it sits on.
export default function SystemHealthBanner() {
  const [warnings, setWarnings] = useState([]);

  useEffect(() => {
    let cancelled = false;
    staffClient.get('/api/dashboard/system-health')
      .then((res) => { if (!cancelled) setWarnings(res.data?.warnings || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (warnings.length === 0) return null;

  return (
    <div role="alert" style={{
      background: 'var(--color-warning-light)', color: 'var(--color-warning)',
      border: '1px solid var(--color-warning)', borderRadius: 'var(--radius)',
      padding: 'var(--spacing-sm) var(--spacing-md)', marginBottom: 'var(--spacing-md)',
      display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14
    }}>
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <strong>System warning</strong>
        {warnings.map((w) => <p key={w} style={{ margin: '4px 0 0' }}>{w}</p>)}
      </div>
    </div>
  );
}
