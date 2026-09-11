import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import ProfileCompletionForm from '../components/ProfileCompletionForm';

// Candidate-level profile fields (personal details, internal employment
// details, work experience, education - all of ProfileCompletionForm,
// the same shared editor used at signup and on the dashboard's completion
// modal) live here rather than on Home/Available Jobs - they're the data
// an application is built from, so they belong alongside the list of
// applications that use them.
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
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="applications" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="My applications" />

          <Card accent="var(--color-primary)">
            <ProfileCompletionForm />
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
