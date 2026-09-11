import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

const emptyWorkExperience = { employer: '', jobTitle: '', startDate: '', endDate: '' };
const emptyEducation = { institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' };

// Candidate-level profile fields (Internal employment details, work
// experience, education) live here rather than on Home/Available Jobs -
// they're the data an application is built from, so they belong alongside
// the list of applications that use them.
export default function CandidateApplications() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [profile, setProfile] = useState({ employeeId: '', department: '', position: '', dateJoined: '', supervisorName: '', supervisorEmail: '' });
  const [profileMessage, setProfileMessage] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [withdrawMessage, setWithdrawMessage] = useState('');

  const [workExperience, setWorkExperience] = useState([]);
  const [education, setEducation] = useState([]);
  const [newWorkExperience, setNewWorkExperience] = useState(emptyWorkExperience);
  const [newEducation, setNewEducation] = useState(emptyEducation);
  const [recordsMessage, setRecordsMessage] = useState('');

  const loadApplications = () => client.get('/api/candidates/me/applications').then((res) => setApplications(res.data));

  const loadMe = () => client.get('/api/candidates/me').then((res) => {
    setWorkExperience(res.data.workExperience || []);
    setEducation(res.data.education || []);
    if (res.data.internalProfile) {
      const p = res.data.internalProfile;
      setProfile({
        employeeId: p.employeeId || '', department: p.department || '', position: p.position || '',
        dateJoined: p.dateJoined ? p.dateJoined.slice(0, 10) : '',
        supervisorName: p.supervisorName || '', supervisorEmail: p.supervisorEmail || ''
      });
    }
  });

  useEffect(() => {
    loadApplications();
    loadMe();
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

  const addWorkExperience = async (e) => {
    e.preventDefault();
    setRecordsMessage('');
    try {
      await client.post('/api/candidates/me/work-experience', newWorkExperience);
      setNewWorkExperience(emptyWorkExperience);
      loadMe();
    } catch (err) {
      setRecordsMessage(err.response?.data?.error || 'Could not add work experience');
    }
  };

  // qualificationLevel is now a controlled, ordered dropdown, not free
  // text - required for any future "meets minimum education" comparison
  // during screening to mean anything reliable.
  const addEducation = async (e) => {
    e.preventDefault();
    setRecordsMessage('');
    try {
      await client.post('/api/candidates/me/education', newEducation);
      setNewEducation(emptyEducation);
      loadMe();
    } catch (err) {
      setRecordsMessage(err.response?.data?.error || 'Could not add education');
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

  // Cancelling a Draft deletes it outright - HR never saw it, so a
  // candidate who changes their mind can start a genuinely fresh
  // application to the same vacancy afterward. Withdrawing a Submitted
  // application is a one-way door instead: the row is kept (as
  // Withdrawn), and re-applying to that vacancy is refused - it's a real,
  // HR-visible commitment being backed out of, not a form thrown away.
  const cancelDraft = async (applicationId) => {
    if (!window.confirm('Cancel this draft? You can start a fresh application to this vacancy afterward.')) return;
    setWithdrawMessage('');
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      loadApplications();
    } catch (err) {
      setWithdrawMessage(err.response?.data?.error || 'Could not cancel draft');
    }
  };

  const withdrawApplication = async (applicationId) => {
    if (!window.confirm('Withdraw this application? This cannot be undone, and you will not be able to re-apply to this vacancy.')) return;
    setWithdrawMessage('');
    try {
      await client.patch(`/api/applications/${applicationId}/withdraw`);
      loadApplications();
    } catch (err) {
      setWithdrawMessage(err.response?.data?.error || 'Could not withdraw');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="applications" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="My applications" />

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

          <Card accent="var(--color-primary)">
            <h3 style={{ marginTop: 0 }}>Work experience</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Candidate-level, reused across every application, and snapshotted fresh at each submission.
            </p>
            {workExperience.map((w) => (
              <div key={w.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{w.jobTitle}</strong> at {w.employer} &middot; {new Date(w.startDate).toLocaleDateString()}
                {' '}&ndash;{' '}{w.endDate ? new Date(w.endDate).toLocaleDateString() : 'present'}
              </div>
            ))}
            <form onSubmit={addWorkExperience} style={{ marginTop: 12 }}>
              <TextField label="Employer" value={newWorkExperience.employer}
                onChange={(e) => setNewWorkExperience({ ...newWorkExperience, employer: e.target.value })} required />
              <TextField label="Job title" value={newWorkExperience.jobTitle}
                onChange={(e) => setNewWorkExperience({ ...newWorkExperience, jobTitle: e.target.value })} required />
              <TextField label="Start date" type="date" value={newWorkExperience.startDate}
                onChange={(e) => setNewWorkExperience({ ...newWorkExperience, startDate: e.target.value })} required />
              <TextField label="End date (leave blank if ongoing)" type="date" value={newWorkExperience.endDate}
                onChange={(e) => setNewWorkExperience({ ...newWorkExperience, endDate: e.target.value })} />
              <Button type="submit" variant="secondary">Add work experience</Button>
            </form>
          </Card>

          <Card accent="var(--color-primary)">
            <h3 style={{ marginTop: 0 }}>Education</h3>
            {education.map((ed) => (
              <div key={ed.id} style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{ed.qualificationLevel || ed.qualificationLevelText}</strong> &mdash; {ed.fieldOfStudy}, {ed.institution}
                {ed.yearCompleted ? ` (${ed.yearCompleted})` : ''}
              </div>
            ))}
            <form onSubmit={addEducation} style={{ marginTop: 12 }}>
              <TextField label="Institution" value={newEducation.institution}
                onChange={(e) => setNewEducation({ ...newEducation, institution: e.target.value })} required />
              <Select label="Qualification level" value={newEducation.qualificationLevel}
                onChange={(e) => setNewEducation({ ...newEducation, qualificationLevel: e.target.value })} required>
                <option value="">Select a level</option>
                <option value="Certificate">Certificate</option>
                <option value="Diploma">Diploma</option>
                <option value="Bachelors">Bachelor's</option>
                <option value="Masters">Master's</option>
                <option value="PhD">PhD</option>
              </Select>
              <TextField label="Field of study" value={newEducation.fieldOfStudy}
                onChange={(e) => setNewEducation({ ...newEducation, fieldOfStudy: e.target.value })} required />
              <TextField label="Year completed (optional)" type="number" value={newEducation.yearCompleted}
                onChange={(e) => setNewEducation({ ...newEducation, yearCompleted: e.target.value })} />
              <Button type="submit" variant="secondary">Add education</Button>
            </form>
            <Alert type="error" message={recordsMessage} />
          </Card>

          <h3>My applications</h3>
          <Alert type="info" message={offerMessage} />
          <Alert type="info" message={withdrawMessage} />
          {applications.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>You haven't applied to any vacancies yet.</p>}
          {applications.map((app) => (
            <Card key={app.id}>
              <strong>{app.vacancy.title}</strong> &mdash; <StatusBadge status={app.status} />
              {app.status === 'Draft' && (
                <>
                  <Link to={`/apply/${app.vacancy.id}`} style={{ marginLeft: 8 }}>Continue draft</Link>
                  <Button variant="ghost" style={{ marginLeft: 8, padding: '2px 10px', color: 'var(--color-danger)' }}
                    onClick={() => cancelDraft(app.id)}>Cancel</Button>
                </>
              )}
              {app.status === 'Submitted' && (
                <Button variant="ghost" style={{ marginLeft: 8, padding: '2px 10px', color: 'var(--color-danger)' }}
                  onClick={() => withdrawApplication(app.id)}>Withdraw</Button>
              )}
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
      </div>
    </div>
  );
}
