import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function VerifyCode() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      const res = await client.post('/api/candidates/auth/confirm-code', { email, code });
      setMessage(res.data.message);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    }
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <PageHeader
        title="Enter verification code"
        subtitle="We emailed a 6-digit code to your @caa.co.ug address. Enter it below to activate your account."
      />
      <form onSubmit={handleSubmit}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label="Verification code" value={code}
          onChange={(e) => setCode(e.target.value)} required maxLength={6} />
        <Button type="submit">Verify</Button>
      </form>
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />
      <p><Link to={`/resend-verification?email=${encodeURIComponent(email)}`}>Didn't get a code? Resend it</Link></p>
    </div>
  );
}
