import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Alert from '../components/Alert';

export default function ConfirmEmail() {
  const [params] = useSearchParams();
  const [message, setMessage] = useState('Confirming...');
  const [ok, setOk] = useState(true);

  useEffect(() => {
    const token = params.get('token');
    client.get('/api/candidates/auth/confirm-email', { params: { token } })
      .then((res) => setMessage(res.data.message))
      .catch((err) => { setOk(false); setMessage(err.response?.data?.error || 'Confirmation failed'); });
  }, [params]);

  return (
    <div>
      <PageHeader title="Email confirmation" />
      <Alert type={ok ? 'success' : 'error'} message={message} />
      {ok ? (
        <Link to="/login">Go to login</Link>
      ) : (
        <p><Link to="/resend-verification">Request a new verification link</Link></p>
      )}
    </div>
  );
}
