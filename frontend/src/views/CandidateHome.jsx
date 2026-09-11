import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, FileText } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import Card from '../components/Card';

function KpiCard({ icon: Icon, label, value, accent, loading, to }) {
  return (
    <Link to={to} style={{ textDecoration: 'none' }}>
      <Card accent={accent} style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-subtle)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0
            }}
          >
            <Icon size={22} color={accent} />
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.1 }}>
              {loading ? '—' : value}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{label}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

// Default landing page after candidate login (see CandidateLogin.jsx).
// "Available" matches vacancyController.listPublic's own status filter -
// this reuses that same public endpoint rather than inventing a new count.
export default function CandidateHome() {
  const { candidate } = useAuth();
  const [jobCount, setJobCount] = useState(0);
  const [applicationCount, setApplicationCount] = useState(0);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(true);

  useEffect(() => {
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params })
      .then((res) => setJobCount(res.data.length))
      .finally(() => setLoadingJobs(false));
    client.get('/api/candidates/me/applications')
      .then((res) => setApplicationCount(res.data.length))
      .finally(() => setLoadingApplications(false));
  }, [candidate]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="home" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 'var(--spacing-lg)' }}>
            <h1 style={{ margin: 0, color: 'var(--color-primary-dark)' }}>
              Welcome{candidate?.fullName ? `, ${candidate.fullName.split(' ')[0]}` : ''}
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)' }}>
              Here's a quick look at what's open and where your applications stand.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 'var(--spacing-md)'
            }}
          >
            <KpiCard
              icon={Briefcase}
              label="Available Jobs"
              value={jobCount}
              accent="var(--color-primary)"
              loading={loadingJobs}
              to="/dashboard/jobs"
            />
            <KpiCard
              icon={FileText}
              label="My Applications"
              value={applicationCount}
              accent="var(--color-accent)"
              loading={loadingApplications}
              to="/dashboard/applications"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
