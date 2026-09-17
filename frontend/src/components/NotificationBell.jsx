import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Spinner from './Spinner';
import Skeleton from './Skeleton';

const POLL_MS = 30000;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  // Only ever gates the FIRST load - the 30s poll after that updates the
  // list in place without re-showing a loading state over data already on
  // screen (same reasoning as HRDashboard.jsx's loadingVacancies).
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [markingReadId, setMarkingReadId] = useState(null);
  const containerRef = useRef(null);

  const load = () => staffClient.get('/api/notifications/mine')
    .then((res) => setNotifications(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load notifications'))
    .finally(() => setLoading(false));

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const markRead = async (id) => {
    setMarkingReadId(id);
    try {
      await staffClient.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark notification read');
    } finally {
      setMarkingReadId(null);
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer'
        }}
      >
        <Bell size={16} />
        {notifications.length > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, background: 'var(--color-danger)', color: '#fff',
            borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 6px', lineHeight: '14px'
          }}>
            {notifications.length}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 340, maxHeight: 420,
          overflowY: 'auto', background: 'var(--color-bg)', color: 'var(--color-text)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 20
        }}>
          {loading && [0, 1, 2].map((i) => (
            <div key={i} style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
              <Skeleton width={`${85 - i * 10}%`} height={13} style={{ marginBottom: 8 }} />
              <Skeleton width="35%" height={11} />
            </div>
          ))}
          {!loading && error && <div style={{ padding: 12, fontSize: 13, color: 'var(--color-danger)' }}>{error}</div>}
          {!loading && notifications.length === 0 && !error && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>No unread notifications.</div>
          )}
          {!loading && notifications.map((n) => (
            <div key={n.id} style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 13 }}>{n.message}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {new Date(n.sentAt).toLocaleString()}
                </span>
                <button
                  onClick={() => markRead(n.id)}
                  disabled={markingReadId === n.id}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: markingReadId === n.id ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  {markingReadId === n.id && <Spinner size={10} color="currentColor" />}
                  {markingReadId === n.id ? 'Marking...' : 'Mark read'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
