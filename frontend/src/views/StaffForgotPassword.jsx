import React, { useState } from 'react';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function StaffForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const res = await client.post('/api/staff/auth/forgot-password', { email });
    setMessage(res.data.message);
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <PageHeader title="Staff: forgot password" />
      <form onSubmit={handleSubmit}>
        <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit">Send reset link</Button>
      </form>
      <Alert type="info" message={message} />
    </div>
  );
}
