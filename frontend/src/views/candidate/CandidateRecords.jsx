import React, { useEffect, useState } from 'react';
import { Briefcase, GraduationCap } from 'lucide-react';
import client from '../../models/apiClient';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import TextField from '../../components/TextField';
import Select from '../../components/Select';
import Button from '../../components/Button';
import Alert from '../../components/Alert';

const emptyWorkExperience = { employer: '', jobTitle: '', startDate: '', endDate: '' };
const emptyEducation = { institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '' };

export default function CandidateRecords() {
  const [workExperience, setWorkExperience] = useState([]);
  const [education, setEducation] = useState([]);
  const [newWorkExperience, setNewWorkExperience] = useState(emptyWorkExperience);
  const [newEducation, setNewEducation] = useState(emptyEducation);
  const [recordsMessage, setRecordsMessage] = useState('');

  const loadMe = () => client.get('/api/candidates/me').then((res) => {
    setWorkExperience(res.data.workExperience || []);
    setEducation(res.data.education || []);
  });

  useEffect(() => { loadMe(); }, []);

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

  return (
    <div>
      <PageHeader eyebrow="Candidate" title="Experience & education" subtitle="Reused across every application you submit" />

      <Alert type="error" message={recordsMessage} />

      <Card>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Briefcase size={17} style={{ color: 'var(--color-primary)' }} /> Work experience
        </h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Candidate-level, reused across every application, and snapshotted fresh at each submission.
        </p>
        {workExperience.map((w) => (
          <div key={w.id} style={{
            fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)'
          }}>
            <strong>{w.jobTitle}</strong> at {w.employer}
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12.5, marginTop: 2 }}>
              {new Date(w.startDate).toLocaleDateString()} &ndash; {w.endDate ? new Date(w.endDate).toLocaleDateString() : 'present'}
            </div>
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

      <Card>
        <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <GraduationCap size={17} style={{ color: 'var(--color-primary)' }} /> Education
        </h3>
        {education.map((ed) => (
          <div key={ed.id} style={{
            fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)'
          }}>
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
      </Card>
    </div>
  );
}
