import React, { useEffect, useState } from 'react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

export default function CandidateDashboard() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [profile, setProfile] = useState({ employeeId: '', department: '', position: '', dateJoined: '', supervisorName: '', supervisorEmail: '' });
  const [profileMessage, setProfileMessage] = useState('');
  const [offerMessage, setOfferMessage] = useState('');

  const loadApplications = () => client.get('/api/candidates/me/applications').then((res) => setApplications(res.data));

  useEffect(() => {
    loadApplications();
    if (candidate?.candidateType === 'Internal') {
      client.get('/api/candidates/me').then((res) => {
        if (res.data.internalProfile) {
          const p = res.data.internalProfile;
          setProfile({
            employeeId: p.employeeId || '', department: p.department || '', position: p.position || '',
            dateJoined: p.dateJoined ? p.dateJoined.slice(0, 10) : '',
            supervisorName: p.supervisorName || '', supervisorEmail: p.supervisorEmail || ''
          });
        }
      });
    }
  }, [candidate]);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await client.put('/api/candidates/me/internal-profile', profile);
      setProfileMessage('Saved. HR will verify this before your applications can be shortlisted.');
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Failed to save');
    }
  };

  const respondToOffer = async (offerId, action) => {
    setOfferMessage('');
    try {
      await client.patch(`/api/applications/offers/${offerId}/${action}`);
      setOfferMessage(action === 'accept' ? 'Offer accepted. Congratulations!' : 'Offer declined.');
      loadApplications();
    } catch (err) {
      setOfferMessage(err.response?.data?.error || 'Could not record your response');
    }
  };

  return (
    <div>
      <PageHeader title="My dashboard" />

      {candidate?.candidateType === 'Internal' && (
        <Card accent="var(--color-primary)">
          <h3 style={{ marginTop: 0 }}>Internal employment details</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Required for any internal application to proceed past initial review. HR must verify this before shortlisting.
          </p>
          <form onSubmit={saveProfile}>
            <TextField label="Employee ID" value={profile.employeeId}
              onChange={(e) => setProfile({ ...profile, employeeId: e.target.value })} />
            <TextField label="Department" value={profile.department}
              onChange={(e) => setProfile({ ...profile, department: e.target.value })} />
            <TextField label="Position" value={profile.position}
              onChange={(e) => setProfile({ ...profile, position: e.target.value })} />
            <TextField label="Date joined" type="date" value={profile.dateJoined}
              onChange={(e) => setProfile({ ...profile, dateJoined: e.target.value })} />
            <TextField label="Supervisor name" value={profile.supervisorName}
              onChange={(e) => setProfile({ ...profile, supervisorName: e.target.value })} />
            <TextField label="Supervisor email" value={profile.supervisorEmail}
              onChange={(e) => setProfile({ ...profile, supervisorEmail: e.target.value })} />
            <Button type="submit">Save</Button>
          </form>
          <Alert type="info" message={profileMessage} />
        </Card>
      )}

      <h3>My applications</h3>
      <Alert type="info" message={offerMessage} />
      {applications.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>You haven't applied to any vacancies yet.</p>}
      {applications.map((app) => (
        <Card key={app.id}>
          <strong>{app.vacancy.title}</strong> &mdash; <StatusBadge status={app.status} />
          {app.offer && (
            <div style={{ marginTop: 8 }}>
              Offer: <StatusBadge status={app.offer.status} />
              {app.offer.status === 'Approved' && (
                <div style={{ marginTop: 8 }}>
                  <Button onClick={() => respondToOffer(app.offer.id, 'accept')}>Accept offer</Button>{' '}
                  <Button variant="ghost" onClick={() => respondToOffer(app.offer.id, 'decline')}>Decline</Button>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
