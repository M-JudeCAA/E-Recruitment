import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import useNotifications from '../hooks/useNotifications';

export default function NotificationBell() {
  const { notifications, error, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          background: 'transparent', border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)', borderRadius: 'var(--radius-sm)',
          padding: '7px 10px', fontSize: 14, cursor: 'pointer'
        }}
      >
        <Bell size={15} />
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
