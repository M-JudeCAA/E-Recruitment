import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import { signInWithMicrosoft, isEntraConfigured } from '../models/entraAuth';
import MicrosoftSignInButton from './MicrosoftSignInButton';
import Alert from './Alert';

// "Sign in with your UCAA account" for internal candidates - every UCAA
// employee, HR staff included, applies through this (a separate candidate
// session; their staff account, if any, is untouched). The first sign-in
// creates their Internal candidate account. Shared by CandidateLogin and
// Register; lands where a password login would (returnTo, else first-time
// profile completion, else the dashboard).
export default function UcaaAccountSignIn({ returnTo, highlight = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { loginCandidate } = useAuth();
  const navigate = useNavigate();

  if (!isEntraConfigured('candidate')) return null;

  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      const idToken = await signInWithMicrosoft('candidate');
      if (!idToken) return; // closed the Microsoft window
      const res = await client.post('/api/candidates/auth/entra', { idToken });
      loginCandidate(res.data.token, res.data.candidateType, res.data.fullName, res.data.photoUrl, res.data.email);
      sessionStorage.removeItem('pendingReturnTo');
      if (returnTo) navigate(returnTo, { replace: true });
      else if (res.data.firstLogin) navigate('/profile/complete', { replace: true });
      else navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      marginTop: 4, marginBottom: 18, padding: highlight ? 12 : 0, borderRadius: 'var(--radius-sm)',
      background: highlight ? 'var(--color-primary-light)' : 'transparent'
    }}>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
        UCAA staff: apply with your work account.
      </p>
      <MicrosoftSignInButton onClick={signIn} loading={busy}>Sign in with your UCAA account</MicrosoftSignInButton>
      <Alert type="error" message={error} />
    </div>
  );
}
