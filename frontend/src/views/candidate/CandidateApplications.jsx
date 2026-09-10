import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../../models/apiClient';
import { useAuth } from '../../models/AuthContext';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import SectionHeading from '../../components/SectionHeading';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import StatusBadge from '../../components/StatusBadge';

export default function CandidateApplications() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [offerMessage, setOfferMessage] = useState('');
  const [withdrawMessage, setWithdrawMessage] = useState('');

  const loadApplications = () => client.get('/api/candidates/me/applications').then((res) => setApplications(res.data));

  useEffect(() => {
    loadApplications();
  }, [candidate]);

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
      <PageHeader eyebrow="Candidate" title="My applications" subtitle="Everything you've applied for, in one place" />

      <Alert type="info" message={offerMessage} />
      <Alert type="info" message={withdrawMessage} />

      <SectionHeading count={applications.length}>Applications</SectionHeading>
      {applications.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>You haven't applied to any vacancies yet.</p>}
      {applications.map((app) => (
        <Card key={app.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{app.vacancy.title}</strong>
            <StatusBadge status={app.status} />
          </div>
          {(app.status === 'Draft' || app.status === 'Submitted') && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {app.status === 'Draft' && (
                <>
                  <Link to={`/apply/${app.vacancy.id}`} style={{ fontSize: 13.5, fontWeight: 500 }}>Continue draft</Link>
                  <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13, color: 'var(--color-danger)' }}
                    onClick={() => cancelDraft(app.id)}>Cancel</Button>
                </>
              )}
              {app.status === 'Submitted' && (
                <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13, color: 'var(--color-danger)' }}
                  onClick={() => withdrawApplication(app.id)}>Withdraw</Button>
              )}
            </div>
          )}
          {app.offer && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                Offer: <StatusBadge status={app.offer.status} />
              </div>
              {app.offer.status === 'Approved' && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <Button onClick={() => respondToOffer(app.offer.id, 'accept')}>Accept offer</Button>
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
