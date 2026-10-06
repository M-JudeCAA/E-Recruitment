import React, { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import client from '../../models/apiClient';
import { useAuth, useSessionEndedMessage } from '../../models/AuthContext';
import { signInWithMicrosoft, isEntraConfigured } from '../../models/entraAuth';
import { publicSiteUrl } from '../../internalPort';
import MicrosoftSignInButton from '../../components/MicrosoftSignInButton';
import Alert from '../../components/Alert';

// Internal Careers' only way in (/careers/sign-in): the employee's Microsoft
// work account. No password, no registration, no forgotten password - those
// stay on the public careers site for external applicants. The first
// sign-in creates their Internal candidate account (backend
// candidateAuthController.entraSignIn) and goes to the one-time setup.
const RETURN_TO_RE = /^\/careers(\/[\w/-]*)?$/;

export default function InternalSignIn() {
  const [params] = useSearchParams();
  const returnTo = RETURN_TO_RE.test(params.get('returnTo') || '') ? params.get('returnTo') : null;
  const { candidate, loginCandidate, logoutCandidate } = useAuth();
  const sessionEnded = useSessionEndedMessage();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (candidate?.candidateType === 'Internal') return <Navigate to={returnTo || '/careers'} replace />;

  const signIn = async () => {
    setError(''); setBusy(true);
    try {
      const idToken = await signInWithMicrosoft('candidate');
      if (!idToken) return; // closed the Microsoft window
      const res = await client.post('/api/candidates/auth/entra', { idToken });
      loginCandidate(res.data.token, res.data.candidateType, res.data.fullName, res.data.photoUrl, res.data.email);
      navigate(res.data.firstLogin ? '/careers/welcome' : (returnTo || '/careers'), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws-gate">
      <div className="ws-gate-card">
        <div>
          <div className="ws-note" style={{ marginBottom: 6 }}>UCAA staff only</div>
          <h1 className="page-title" style={{ margin: 0 }}>Internal vacancies at UCAA</h1>
          <p className="ws-note" style={{ margin: '6px 0 0', fontSize: 14 }}>
            Sign in with your work account to see vacancies open to UCAA employees and apply.
          </p>
        </div>
        <Alert type="warning" message={sessionEnded} />
        {candidate && (
          <Alert type="info" message={<>This site is for UCAA employees signing in with their work account. <button type="button" onClick={logoutCandidate} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button> first.</>} />
        )}
        {isEntraConfigured('candidate') ? (
          <MicrosoftSignInButton onClick={signIn} loading={busy}>Sign in with your UCAA account</MicrosoftSignInButton>
        ) : (
          <Alert type="warning" message="Microsoft sign-in has not been set up for this site yet." />
        )}
        <Alert type="error" message={error} />
        <ul className="ws-gate-facts">
          <li><Check size={14} /> No password to create. Your Microsoft work account is all you need.</li>
          <li><Check size={14} /> Your name and work email come from your account.</li>
          <li><Check size={14} /> HR checks your employment details when you apply.</li>
        </ul>
        <div className="ws-gate-foot">
          Not a UCAA employee? Apply on the <a href={publicSiteUrl()}>public careers site</a>.
        </div>
      </div>
    </div>
  );
}
