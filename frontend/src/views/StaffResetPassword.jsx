import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function StaffResetPassword() {
  const [params] = useSearchParams();
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await client.post('/api/staff/auth/reset-password', {
        token: params.get('token'), newPassword
      });
      setMessage(res.data.message);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <PageHeader title="Staff: reset password" />
      <form onSubmit={handleSubmit}>
        <TextField label="New password" type="password" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} />
        <Button type="submit" loading={submitting} loadingText="Resetting...">Reset password</Button>
      </form>
      <Alert type="info" message={message} />
      <p><Link to="/staff/login">Back to login</Link></p>
    </div>
  );
}
