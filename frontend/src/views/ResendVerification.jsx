import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function ResendVerification() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await client.post('/api/candidates/auth/resend-verification', { email });
    setMessage(res.data.message);
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <PageHeader
        title="Resend verification email"
        subtitle="Didn't get the confirmation link, or has it expired? Request a new one."
      />
      <form onSubmit={handleSubmit}>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit">Resend verification email</Button>
      </form>
      <Alert type="info" message={message} />
      <p><Link to={`/verify-code?email=${encodeURIComponent(email)}`}>Have a verification code? Enter it here</Link></p>
      <p><Link to="/login">Back to login</Link></p>
    </div>
  );
}
