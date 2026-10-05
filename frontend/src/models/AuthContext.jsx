import React, { createContext, useContext, useState } from 'react';
import { clearMicrosoftSession } from './entraAuth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [candidate, setCandidate] = useState(() => {
    const type = localStorage.getItem('candidateType');
    const fullName = localStorage.getItem('candidateName');
    const photoUrl = localStorage.getItem('candidatePhotoUrl') || null;
    const email = localStorage.getItem('candidateEmail') || null;
    return localStorage.getItem('candidateToken') ? { candidateType: type, fullName, photoUrl, email } : null;
  });
  const [staff, setStaff] = useState(() => {
    // role is null for an accounts-only system administrator.
    const role = localStorage.getItem('staffRole') || null;
    const name = localStorage.getItem('staffName');
    const email = localStorage.getItem('staffEmail') || null;
    const isSystemAdmin = localStorage.getItem('staffIsSystemAdmin') === 'true';
    return localStorage.getItem('staffToken') ? { role, name, email, isSystemAdmin } : null;
  });

  function loginCandidate(token, candidateType, fullName, photoUrl, email) {
    localStorage.setItem('candidateToken', token);
    localStorage.setItem('candidateType', candidateType);
    if (fullName) localStorage.setItem('candidateName', fullName);
    if (photoUrl) localStorage.setItem('candidatePhotoUrl', photoUrl);
    else localStorage.removeItem('candidatePhotoUrl');
    if (email) localStorage.setItem('candidateEmail', email);
    else localStorage.removeItem('candidateEmail');
    setCandidate({ candidateType, fullName, photoUrl: photoUrl || null, email: email || null });
  }
  function logoutCandidate() {
    localStorage.removeItem('candidateToken');
    localStorage.removeItem('candidateType');
    localStorage.removeItem('candidateName');
    localStorage.removeItem('candidatePhotoUrl');
    localStorage.removeItem('candidateEmail');
    clearMicrosoftSession('candidate');
    setCandidate(null);
  }
  // Called right after a photo upload/removal (ProfileCompletionForm's
  // PhotoUploadPanel) so the Navbar avatar updates immediately, without
  // requiring a fresh login - AuthContext otherwise only ever reflects
  // what the login response carried.
  function updateCandidatePhoto(photoUrl) {
    if (photoUrl) localStorage.setItem('candidatePhotoUrl', photoUrl);
    else localStorage.removeItem('candidatePhotoUrl');
    setCandidate((c) => (c ? { ...c, photoUrl } : c));
  }

  function loginStaff(token, role, name, email, isSystemAdmin = false) {
    localStorage.setItem('staffToken', token);
    if (role) localStorage.setItem('staffRole', role);
    else localStorage.removeItem('staffRole');
    localStorage.setItem('staffName', name);
    if (email) localStorage.setItem('staffEmail', email);
    else localStorage.removeItem('staffEmail');
    localStorage.setItem('staffIsSystemAdmin', String(Boolean(isSystemAdmin)));
    setStaff({ role: role || null, name, email: email || null, isSystemAdmin: Boolean(isSystemAdmin) });
  }
  function logoutStaff() {
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffRole');
    localStorage.removeItem('staffName');
    localStorage.removeItem('staffEmail');
    localStorage.removeItem('staffIsSystemAdmin');
    clearMicrosoftSession('staff');
    setStaff(null);
  }

  return (
    <AuthContext.Provider value={{ candidate, staff, loginCandidate, logoutCandidate, updateCandidatePhoto, loginStaff, logoutStaff }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
