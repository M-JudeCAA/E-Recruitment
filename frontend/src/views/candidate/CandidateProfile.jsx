import React, { useEffect, useState } from 'react';
import client from '../../models/apiClient';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import TextField from '../../components/TextField';
import Button from '../../components/Button';
import Alert from '../../components/Alert';

export default function CandidateProfile() {
  const [profile, setProfile] = useState({ employeeId: '', department: '', position: '', dateJoined: '', supervisorName: '', supervisorEmail: '' });
  const [profileMessage, setProfileMessage] = useState('');

  useEffect(() => {
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
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await client.put('/api/candidates/me/internal-profile', profile);
      setProfileMessage('Saved. HR will verify this before your applications can be shortlisted.');
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Failed to save');
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Candidate" title="Internal profile" subtitle="Required for any internal application to proceed past initial review" />

      <Card>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
          HR must verify this before shortlisting can happen.
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
    </div>
  );
}
