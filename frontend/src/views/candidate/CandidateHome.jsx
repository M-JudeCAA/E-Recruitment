import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileStack, FileEdit, Send, Award, ArrowRight, CircleCheck, IdCard, Briefcase, Calendar, Sparkles } from 'lucide-react';
import client from '../../models/apiClient';
import { useAuth } from '../../models/AuthContext';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import StatTile from '../../components/StatTile';
import SectionHeading from '../../components/SectionHeading';
import StatusBadge from '../../components/StatusBadge';

// An advert counts as "new" for this many days after it actually went
// live - i.e. from approval, not from whenever HR first drafted it,
// since a vacancy can sit in PendingApproval for a while before a
// candidate ever gets to see it.
const NEW_ADVERT_WINDOW_DAYS = 7;

function isNewAdvert(vacancy) {
  const postedAt = vacancy.approvedAt || vacancy.createdAt;
  if (!postedAt) return false;
  const ageMs = Date.now() - new Date(postedAt).getTime();
  return ageMs >= 0 && ageMs < NEW_ADVERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export default function CandidateHome() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [openVacancies, setOpenVacancies] = useState([]);
  const [hasInternalProfile, setHasInternalProfile] = useState(true);

  useEffect(() => {
    client.get('/api/candidates/me/applications').then((res) => setApplications(res.data));
    client.get('/api/vacancies', { params: candidate ? { candidateType: candidate.candidateType } : {} })
      .then((res) => setOpenVacancies(res.data));
    if (candidate?.candidateType === 'Internal') {
      client.get('/api/candidates/me').then((res) => setHasInternalProfile(!!res.data.internalProfile));
    }
  }, [candidate]);

  const draftCount = applications.filter((a) => a.status === 'Draft').length;
  const submittedCount = applications.filter((a) => a.status !== 'Draft' && a.status !== 'Withdrawn').length;
  const offersAwaitingResponse = applications.filter((a) => a.offer?.status === 'Approved');
  const offerCount = applications.filter((a) => a.offer).length;
  const draftsToFinish = applications.filter((a) => a.status === 'Draft');

  const actionItems = [
    ...(candidate?.candidateType === 'Internal' && !hasInternalProfile ? [{
      key: 'profile', text: 'Complete your internal employment details', to: '/dashboard/profile'
    }] : []),
    ...offersAwaitingResponse.map((a) => ({
      key: `offer-${a.id}`, text: `Respond to your offer for ${a.vacancy.title}`, to: '/dashboard/applications'
    })),
    ...draftsToFinish.map((a) => ({
      key: `draft-${a.id}`, text: `Finish your draft application for ${a.vacancy.title}`, to: `/apply/${a.vacancy.id}`
    }))
  ];

  const recentApplications = applications.slice(0, 5);

  // Vacancies already applied to get an "Applied" hint instead of an
  // Apply link - re-applying to the same vacancy is refused server-side
  // once withdrawn, and pointless while a Draft/Submitted one already
  // exists, so surfacing that here saves a dead-end click.
  const appliedVacancyIds = new Set(applications.map((a) => a.vacancy.id));
  const vacanciesToShow = [...openVacancies]
    .sort((a, b) => new Date(b.approvedAt || b.createdAt) - new Date(a.approvedAt || a.createdAt))
    .slice(0, 6);

  return (
    <div>
      <PageHeader
        eyebrow="Candidate"
        title={`Welcome back, ${candidate?.fullName?.split(' ')[0] || 'there'}`}
        subtitle="Here's where things stand with your applications"
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <StatTile icon={FileStack} label="Total applications" value={applications.length} />
        <StatTile icon={FileEdit} label="Drafts" value={draftCount} color="var(--color-text-muted)" tint="var(--color-muted-tint)" />
        <StatTile icon={Send} label="Submitted" value={submittedCount} color="var(--color-primary)" tint="var(--color-primary-tint)" />
        <StatTile icon={Award} label="Offers" value={offerCount} color="var(--color-accent)" tint="var(--color-accent-tint)" />
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <Card>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <IdCard size={17} style={{ color: 'var(--color-warning)' }} /> Needs your attention
            </h3>
            {actionItems.length === 0 && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CircleCheck size={15} style={{ color: 'var(--color-accent)' }} /> Nothing pending right now.
              </p>
            )}
            {actionItems.map((item) => (
              <Link key={item.key} to={item.to} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)',
                textDecoration: 'none', color: 'var(--color-text)', fontSize: 13.5
              }}>
                {item.text}
                <ArrowRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              </Link>
            ))}
          </Card>
        </div>

        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <Card>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 16 }}>Recent applications</h3>
            {recentApplications.length === 0 && (
              <p style={{ fontSize: 13.5, color: 'var(--color-text-muted)' }}>You haven't applied to any vacancies yet.</p>
            )}
            {recentApplications.map((app) => (
              <div key={app.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '10px 0', borderBottom: '1px solid var(--color-border-subtle)'
              }}>
                <span style={{ fontSize: 13.5 }}>{app.vacancy.title}</span>
                <StatusBadge status={app.status} />
              </div>
            ))}
            {applications.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <Link to="/dashboard/applications" style={{ fontSize: 13, fontWeight: 500 }}>View all applications</Link>
              </div>
            )}
          </Card>
        </div>
      </div>

      <SectionHeading
        count={openVacancies.length}
        action={<Link to="/" style={{ fontSize: 13, fontWeight: 500 }}>View all vacancies</Link>}
      >
        Open vacancies
      </SectionHeading>
      {vacanciesToShow.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No open vacancies at the moment.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {vacanciesToShow.map((v) => {
          const alreadyApplied = appliedVacancyIds.has(v.id);
          return (
            <Card key={v.id} style={{ marginBottom: 0, position: 'relative' }}>
              {isNewAdvert(v) && (
                <span style={{
                  position: 'absolute', top: 14, right: 14, display: 'flex', alignItems: 'center', gap: 3,
                  background: 'var(--color-primary)', color: '#fff', borderRadius: 999,
                  padding: '2px 9px 2px 7px', fontSize: 11, fontWeight: 700, letterSpacing: 0.2
                }}>
                  <Sparkles size={11} /> New
                </span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
                <Briefcase size={13} /> {v.department?.name}
              </div>
              <h3 style={{ margin: '6px 0 8px', fontSize: 15, paddingRight: isNewAdvert(v) ? 56 : 0 }}>{v.title}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-text-muted)', marginBottom: 12 }}>
                <span>{v.positionsRequired} position(s)</span>
                {v.deadline && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={12.5} /> {new Date(v.deadline).toLocaleDateString()}
                  </span>
                )}
              </div>
              {alreadyApplied ? (
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>Already applied</span>
              ) : (
                <Link to={`/apply/${v.id}`} style={{ fontSize: 13, fontWeight: 500 }}>Apply</Link>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
