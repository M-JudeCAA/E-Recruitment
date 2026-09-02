import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [candidate, setCandidate] = useState(() => {
    const type = localStorage.getItem('candidateType');
    return localStorage.getItem('candidateToken') ? { candidateType: type } : null;
  });
  const [staff, setStaff] = useState(() => {
    const role = localStorage.getItem('staffRole');
    const name = localStorage.getItem('staffName');
    return localStorage.getItem('staffToken') ? { role, name } : null;
  });

  function loginCandidate(token, candidateType) {
    localStorage.setItem('candidateToken', token);
    localStorage.setItem('candidateType', candidateType);
    setCandidate({ candidateType });
  }
  function logoutCandidate() {
    localStorage.removeItem('candidateToken');
    localStorage.removeItem('candidateType');
    setCandidate(null);
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
    <AuthContext.Provider value={{ candidate, staff, loginCandidate, logoutCandidate, loginStaff, logoutStaff }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
