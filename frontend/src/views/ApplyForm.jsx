import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Alert from '../components/Alert';

export default function ApplyForm() {
  const { vacancyId } = useParams();
  const [vacancy, setVacancy] = useState(null);
  const [cv, setCv] = useState(null);
  const [coverLetter, setCoverLetter] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    client.get(`/api/vacancies/${vacancyId}`).then((res) => setVacancy(res.data));
  }, [vacancyId]);

  // Shared by both buttons - saves (or updates) the same Draft row. No CV
  // required at this stage; posting-type/vacancy-acceptance checks apply,
  // but the deadline deliberately does not - a draft started in good faith
  // can still be edited as a deadline approaches or passes.
  const saveDraft = async () => {
    const formData = new FormData();
    formData.append('vacancyId', vacancyId);
    if (cv) formData.append('cv', cv);
    if (coverLetter) formData.append('coverLetter', coverLetter);

    const res = await client.post('/api/applications', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  };

  const handleSaveDraftOnly = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    try {
      await saveDraft();
      setMessage('Draft saved. You can finish this later from your dashboard.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save draft');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(''); setError('');
    if (!cv) { setError('A CV upload is required to submit'); return; }

    try {
      const draft = await saveDraft();
      await client.patch(`/api/applications/${draft.id}/submit`);
      setMessage('Application submitted.');
      setTimeout(() => navigate('/dashboard'), 1000);
    } catch (err) {
      setError(err.response?.data?.error || 'Submission failed');
    }
  };

  return (
    <div style={{ maxWidth: 420 }}>
      <PageHeader title={vacancy ? vacancy.title : 'Apply'} subtitle={vacancy ? vacancy.department : undefined} />
      {vacancy?.description && (
        <div
          className="rich-text-content"
          dangerouslySetInnerHTML={{ __html: vacancy.description }}
          style={{ marginBottom: 'var(--spacing-md)' }}
        />
      )}
      <form>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>CV (PDF or Word)</label>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files[0])} style={{ display: 'block', marginBottom: 16 }} />
        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>Cover letter (optional)</label>
        <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCoverLetter(e.target.files[0])} style={{ display: 'block', marginBottom: 16 }} />
        <Button type="button" variant="ghost" onClick={handleSaveDraftOnly}>Save as draft</Button>{' '}
        <Button type="button" onClick={handleSubmit}>Submit application</Button>
      </form>
      <Alert type="success" message={message} />
      <Alert type="error" message={error} />
    </div>
  );
}
