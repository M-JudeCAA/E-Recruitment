import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import ProfileCompletionForm from '../components/ProfileCompletionForm';
import AvailableJobsList from '../components/AvailableJobsList';
import { isProfileComplete } from '../utils/profileCompleteness';

// Internal employment details, work experience, and education used to
// have their own separate inline forms here, duplicating exactly what
// ProfileCompletionForm now edits (see the modal below) - removed in
// favor of that one shared form, reachable here via "Complete your
// profile" (incomplete) or "Edit your profile" (complete) at any time,
// not only right after a fresh signup.
export default function CandidateDashboard() {
  const { candidate } = useAuth();
  const [applications, setApplications] = useState([]);
  const [offerMessage, setOfferMessage] = useState('');
  const [withdrawMessage, setWithdrawMessage] = useState('');

  // Old User path: a returning candidate with an incomplete profile sees
  // this closable modal over the dashboard on every visit (it isn't
  // persisted as dismissed) - closing it swaps in the banner below so the
  // prompt can be reopened. Once complete, the same modal/button stay
  // reachable (as "Edit your profile") rather than disappearing outright.
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileIncomplete, setProfileIncomplete] = useState(false);

  const loadApplications = () => client.get('/api/candidates/me/applications').then((res) => setApplications(res.data));

  const loadMe = () => client.get('/api/candidates/me').then((res) => {
    const incomplete = !isProfileComplete(res.data);
    setProfileIncomplete(incomplete);
    if (incomplete) setShowProfileModal(true);
  });

  useEffect(() => {
    loadApplications();
    loadMe();
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
      <PageHeader title="My dashboard" />

      {showProfileModal && (
        <Modal title="Your profile" onClose={() => setShowProfileModal(false)} maxWidth={720}>
          <ProfileCompletionForm onComplete={() => { setShowProfileModal(false); loadMe(); }} />
        </Modal>
      )}
      {!showProfileModal && (
        <Alert type={profileIncomplete ? 'info' : 'success'} message={
          <span>
            {profileIncomplete ? 'Your profile is incomplete.' : 'Your profile is complete.'}{' '}
            <Button variant="ghost" style={{ padding: '2px 10px' }} onClick={() => setShowProfileModal(true)}>
              {profileIncomplete ? 'Complete your profile' : 'Edit your profile'}
            </Button>
          </span>
        } />
      )}

      <h3>Available jobs</h3>
      <AvailableJobsList />

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
  );
}
