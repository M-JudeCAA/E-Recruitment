import React, { useEffect, useRef, useState } from 'react';
import staffClient from '../models/staffApiClient';

const POLL_MS = 30000;

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  const load = () => staffClient.get('/api/notifications/mine')
    .then((res) => setNotifications(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load notifications'));

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
    try {
      await staffClient.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark notification read');
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{
          position: 'relative', background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff', borderRadius: 6, padding: '6px 10px', fontSize: 14, cursor: 'pointer'
        }}
      >
        Notifications
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
          {error && <div style={{ padding: 12, fontSize: 13, color: 'var(--color-danger)' }}>{error}</div>}
          {notifications.length === 0 && !error && (
            <div style={{ padding: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>No unread notifications.</div>
          )}
          {notifications.map((n) => (
            <div key={n.id} style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 13 }}>{n.message}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {new Date(n.sentAt).toLocaleString()}
                </span>
                <button
                  onClick={() => markRead(n.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer' }}
                >
                  Mark read
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
