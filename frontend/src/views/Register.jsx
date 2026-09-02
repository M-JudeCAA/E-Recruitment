import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function Register() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', nationalId: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [registeredType, setRegisteredType] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(''); setError(''); setRegisteredType(null);
    try {
      const res = await client.post('/api/candidates/auth/register', form);
      setMessage(`${res.data.message} (Account type: ${res.data.candidateType})`);
      setRegisteredType(res.data.candidateType);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
    }
  };

  return (
    <div style={{ maxWidth: 420 }}>
      <PageHeader
        title="Create account"
        subtitle="Registering with a @caa.co.ug email creates an internal-staff account automatically."
      />
      <form onSubmit={handleSubmit}>
        <TextField label="Full name" value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
        <TextField label="Email" type="email" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <TextField label="Phone" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <TextField label="National ID / Passport" value={form.nationalId}
          onChange={(e) => setForm({ ...form, nationalId: e.target.value })} />
        <TextField label="Password" type="password" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <Button type="submit">Register</Button>
      </form>
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />
      {registeredType === 'Internal' && (
        <p><Link to={`/verify-code?email=${encodeURIComponent(form.email)}`}>Enter your verification code</Link></p>
      )}
      {registeredType && (
        <p>Didn't get it? <Link to={`/resend-verification?email=${encodeURIComponent(form.email)}`}>Resend verification email</Link></p>
      )}
    </div>
  );
}
