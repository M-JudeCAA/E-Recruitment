import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [candidate, setCandidate] = useState(() => {
    const type = localStorage.getItem('candidateType');
    const fullName = localStorage.getItem('candidateName');
    const photoUrl = localStorage.getItem('candidatePhotoUrl') || null;
    return localStorage.getItem('candidateToken') ? { candidateType: type, fullName, photoUrl } : null;
  });
  const [staff, setStaff] = useState(() => {
    const role = localStorage.getItem('staffRole');
    const name = localStorage.getItem('staffName');
    return localStorage.getItem('staffToken') ? { role, name } : null;
  });

  function loginCandidate(token, candidateType, fullName, photoUrl) {
    localStorage.setItem('candidateToken', token);
    localStorage.setItem('candidateType', candidateType);
    if (fullName) localStorage.setItem('candidateName', fullName);
    if (photoUrl) localStorage.setItem('candidatePhotoUrl', photoUrl);
    else localStorage.removeItem('candidatePhotoUrl');
    setCandidate({ candidateType, fullName, photoUrl: photoUrl || null });
  }
  function logoutCandidate() {
    localStorage.removeItem('candidateToken');
    localStorage.removeItem('candidateType');
    localStorage.removeItem('candidateName');
    localStorage.removeItem('candidatePhotoUrl');
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

  function loginStaff(token, role, name) {
    localStorage.setItem('staffToken', token);
    localStorage.setItem('staffRole', role);
    localStorage.setItem('staffName', name);
    setStaff({ role, name });
  }
  function logoutStaff() {
    localStorage.removeItem('staffToken');
    localStorage.removeItem('staffRole');
    localStorage.removeItem('staffName');
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
