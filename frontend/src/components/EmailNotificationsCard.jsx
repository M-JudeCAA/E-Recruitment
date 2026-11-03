import React, { useEffect, useState } from 'react';
import client from '../models/apiClient';
import Button from './Button';
import Alert from './Alert';

// Whether a candidate's notices are also emailed (backend
// services/emailPreferenceService.js). Signed in it works on their own
// account (My profile); with `token` - the link in every notice email - it
// works without signing in. Off, every notice still shows when they sign in;
// account emails (confirming the address, password reset) always go.
export default function EmailNotificationsCard({ token = null }) {
  const path = token ? `/api/candidates/email-preferences/${encodeURIComponent(token)}` : '/api/candidates/me/email-preferences';
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get(path).then((res) => setState(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load your email settings.'));
  }, [path]);

  const change = async (on) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await client.put(path, { emailNotifications: on });
      setState(res.data);
      setNotice(on ? 'Emails are back on.' : 'Done - you will no longer get these emails.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save that - please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !state) return <Alert type="error" message={error} />;
  if (!state) return <p className="ws-note">Loading...</p>;
  const on = state.emailNotifications;
  return (
    <div style={{ fontSize: 14 }}>
      <Alert type="error" message={error} />
      <Alert type="success" message={notice} />
      <p style={{ marginTop: 0 }}>
        {on
          ? <>Notices about your applications, interviews, offers and employment check are emailed{state.email ? <> to <strong>{state.email}</strong></> : null}, and shown when you sign in.</>
          : <>Notices are <strong>not emailed</strong>{state.email ? <> to {state.email}</> : null} - you see them only when you sign in. You may miss an interview invitation or an offer with a deadline if you don't sign in often.</>}
      </p>
      <p className="ws-note" style={{ marginTop: 0 }}>Emails about your account itself, such as confirming your address or resetting your password, are always sent.</p>
      <Button variant={on ? 'secondary' : 'primary'} loading={busy} loadingText="Saving..." onClick={() => change(!on)}>
        {on ? 'Stop these emails' : 'Email me again'}
      </Button>
    </div>
  );
}
