import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function ApplyForm() {
  const { vacancyId } = useParams();
  const [cv, setCv] = useState(null);
  const [coverLetter, setCoverLetter] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    if (!cv) { setError('A CV upload is required'); return; }

    const formData = new FormData();
    formData.append('vacancyId', vacancyId);
    formData.append('cv', cv);
    if (coverLetter) formData.append('coverLetter', coverLetter);

    try {
      await client.post('/api/applications', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setMessage('Application submitted.');
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed');
    }
  };

  return (
    <div style={{ maxWidth: 420 }}>
      <PageHeader title="Apply" />
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>CV (PDF or Word) *</label>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files[0])} style={{ display: 'block', marginBottom: 16 }} required />
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>Cover letter (optional)</label>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCoverLetter(e.target.files[0])} style={{ display: 'block', marginBottom: 16 }} />
        <Button type="submit">Submit application</Button>
      </form>
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />
    </div>
  );
}
