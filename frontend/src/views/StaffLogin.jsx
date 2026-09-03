import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function StaffLogin() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const { loginStaff } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await client.post('/api/staff/auth/login', form);
      loginStaff(res.data.token, res.data.role, res.data.name, res.data.id);
      navigate('/hr');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div style={{ maxWidth: 360 }}>
      <PageHeader title="Staff login" />
      <form onSubmit={handleSubmit}>
        <TextField label="Email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField label="Password" type="password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit">Log in</Button>
      </form>
      <Alert type="error" message={error} />
      <p><Link to="/staff/forgot-password">Forgot password?</Link></p>
    </div>
  );
}
