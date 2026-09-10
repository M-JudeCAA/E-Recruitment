import { useCallback, useEffect, useState } from 'react';
import staffClient from '../models/staffApiClient';

const POLL_MS = 30000;

// Shared by NotificationBell (dropdown) and the Home tab's inline
// notifications panel - both need the same list/poll/mark-read behavior
// against the same endpoint, so it lives in one place instead of two.
export default function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => staffClient.get('/api/notifications/mine')
    .then((res) => setNotifications(res.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not load notifications')), []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const markRead = useCallback(async (id) => {
    try {
      await staffClient.patch(`/api/notifications/${id}/read`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark notification read');
    }
  }, []);

  return { notifications, error, markRead };
}
