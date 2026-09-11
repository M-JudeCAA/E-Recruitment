import React, { useEffect, useState } from 'react';
import { Briefcase, FileText, Clock } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import Alert from '../components/Alert';

function KpiCard({ icon: Icon, label, value, accent, loading }) {
  return (
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
  );
}

// Default landing page after HR login (see StaffLogin.jsx and Navbar.jsx's
// logo link). "Available" matches vacancyController.listPublic's own
// definition (status Open or PartiallyFilled) rather than inventing a new
// one. Total Applications is cross-vacancy and there's no aggregate
// endpoint for it - same limitation HRDashboard's Applications tab already
// works around - so this fetches each vacancy's applications in parallel
// and sums the counts, the same pattern used there.
export default function HRHome() {
  const [vacancies, setVacancies] = useState([]);
  const [applicationCount, setApplicationCount] = useState(0);
  const [loadingVacancies, setLoadingVacancies] = useState(true);
  const [loadingApplications, setLoadingApplications] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    staffClient.get('/api/vacancies/admin')
      .then((res) => setVacancies(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load vacancies'))
      .finally(() => setLoadingVacancies(false));
  }, []);

  useEffect(() => {
    if (loadingVacancies) return;
    if (vacancies.length === 0) {
      setApplicationCount(0);
      setLoadingApplications(false);
      return;
    }
    setLoadingApplications(true);
    Promise.all(vacancies.map((v) => staffClient.get(`/api/vacancies/${v.id}/applications`)))
      .then((results) => setApplicationCount(results.reduce((sum, res) => sum + res.data.length, 0)))
      .catch((err) => setError(err.response?.data?.error || 'Could not load applications'))
      .finally(() => setLoadingApplications(false));
  }, [loadingVacancies, vacancies]);

  const availableJobs = vacancies.filter((v) => v.status === 'Open' || v.status === 'PartiallyFilled').length;
  const pendingApproval = vacancies.filter((v) => v.status === 'PendingApproval').length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="home" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <Alert type="error" message={error} />

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
              value={availableJobs}
              accent="var(--color-primary)"
              loading={loadingVacancies}
            />
            <KpiCard
              icon={FileText}
              label="Total Applications"
              value={applicationCount}
              accent="var(--color-accent)"
              loading={loadingApplications}
            />
            <KpiCard
              icon={Clock}
              label="Pending Approval"
              value={pendingApproval}
              accent="var(--color-warning)"
              loading={loadingVacancies}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
