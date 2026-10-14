import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronRight } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Spinner from './Spinner';
import Skeleton from './Skeleton';

const POLL_MS = 30000;

// The staff bell: unread notices, newest first. Opening one marks it read
// and goes where it is about (`link` from the API - an approval opens its
// review in the Inbox, anything else the page where the work is).
export default function NotificationBell() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  // Only ever gates the FIRST load - the 30s poll after that updates the
  // list in place without re-showing a loading state over data already on
  // screen (same reasoning as HRDashboard.jsx's loadingVacancies).
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const containerRef = useRef(null);

  const load = () => staffClient.get('/api/notifications/mine')
    .then((res) => { setNotifications(res.data); setError(''); })
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
    await staffClient.patch(`/api/notifications/${id}/read`);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // Marked read on the way - going there is what reading it means.
  const openNotification = async (n) => {
    setBusyId(n.id);
    try {
      await markRead(n.id);
    } catch {
      // Still go there; it stays unread and shows again on the next poll.
    } finally {
      setBusyId(null);
    }
    setOpen(false);
    navigate(n.link || '/hr/inbox');
  };

  const dismiss = async (e, id) => {
    e.stopPropagation();
    setBusyId(id);
    try {
      await markRead(id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark notification read');
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setBusyId('all');
    try {
      await staffClient.patch('/api/notifications/read-all');
      setNotifications([]);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark notifications read');
    } finally {
      setBusyId(null);
    }
  };

  const count = notifications.length;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notifications"
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer'
        }}
      >
        <Bell size={16} />
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6, background: 'var(--color-danger)', color: '#fff',
            borderRadius: 999, fontSize: 11, fontWeight: 700, padding: '1px 6px', lineHeight: '14px'
          }}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 6, width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 460,
          display: 'flex', flexDirection: 'column', background: 'var(--color-bg)', color: 'var(--color-text)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 20
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--color-border)' }}>
            <strong style={{ fontSize: 13 }}>Notifications</strong>
            {count > 0 && (
              <button onClick={markAllRead} disabled={busyId === 'all'}
                style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                {busyId === 'all' && <Spinner size={10} color="currentColor" />}
                Mark all read
              </button>
            )}
          </div>
          <div style={{ overflowY: 'auto' }}>
            {loading && [0, 1, 2].map((i) => (
              <div key={i} style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
                <Skeleton width={`${85 - i * 10}%`} height={13} style={{ marginBottom: 8 }} />
                <Skeleton width="35%" height={11} />
              </div>
            ))}
            {!loading && error && <div style={{ padding: 12, fontSize: 13, color: 'var(--color-danger)' }}>{error}</div>}
            {!loading && count === 0 && !error && (
              <div style={{ padding: 12, fontSize: 13, color: 'var(--color-text-muted)' }}>No unread notifications.</div>
            )}
            {!loading && notifications.map((n) => (
              <div key={n.id} role="button" tabIndex={0}
                onClick={() => openNotification(n)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNotification(n); } }}
                title="Open"
                style={{ padding: 12, borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-primary-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{n.message}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{new Date(n.sentAt).toLocaleString()}</span>
                    <button onClick={(e) => dismiss(e, n.id)} disabled={busyId === n.id}
                      style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {busyId === n.id && <Spinner size={10} color="currentColor" />}
                      Mark read
                    </button>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 2 }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
