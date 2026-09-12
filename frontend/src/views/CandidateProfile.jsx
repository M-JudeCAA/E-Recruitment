import React, { useEffect, useState } from 'react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Avatar from '../components/Avatar';
import ProgressRing from '../components/ProgressRing';
import ProfileCompletionForm from '../components/ProfileCompletionForm';
import { getProfileCompletionPercent } from '../utils/profileCompleteness';
import { candidateFileSrc } from '../utils/fileSrc';

// Its own sidebar stop rather than living at the top of Applications
// (where it used to sit) - profile editing isn't specific to any one
// application, and a standing "My Profile" menu item is where a candidate
// actually expects to find it, separate from the CandidateHome modal that
// used to nudge an incomplete profile (now replaced by Home's own
// completeness ring, which links here). Same shared ProfileCompletionForm
// as /profile/complete, so nothing about how profile data loads/saves
// changes here - only where it lives.
//
// The summary card below is this page's own light `/api/candidates/me`
// fetch (same "each view fetches what it needs" pattern CandidateHome
// already uses for its completeness ring) - it's a glanceable header,
// not a second copy of the form's own data.
export default function CandidateProfile() {
  const { candidate } = useAuth();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    client.get('/api/candidates/me').then((res) => setSummary(res.data));
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="profile" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="My profile" subtitle="Keep your details current - this is what every application is built from." />

          {summary && (
            <Card style={{ marginBottom: 'var(--spacing-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <Avatar src={candidateFileSrc(candidate?.photoUrl)} size={56} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{summary.fullName}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{summary.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {summary.candidateType} candidate &middot; Member since {new Date(summary.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ProgressRing
                    percent={getProfileCompletionPercent(summary)}
                    size={48}
                    strokeWidth={5}
                    color={getProfileCompletionPercent(summary) === 100 ? 'var(--color-accent)' : 'var(--color-primary)'}
                  />
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 90 }}>Profile complete</span>
                </div>
              </div>
            </Card>
          )}

          <Card accent="var(--color-primary)">
            <ProfileCompletionForm />
          </Card>
        </div>
      </div>
    </div>
  );
}
