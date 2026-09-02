import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../models/AuthContext';

const ROLE_RANK = { HR_Officer: 1, Principal_HR_Officer: 2, DHRA_Manager_HR: 3 };

export function RequireStaff({ minRole = 'HR_Officer', children }) {
  const { staff } = useAuth();
  if (!staff) return <Navigate to="/staff/login" replace />;
  if ((ROLE_RANK[staff.role] || 0) < (ROLE_RANK[minRole] || 0)) {
    return <p>You do not have permission to view this page.</p>;
  }
  return children;
}

export function RequireCandidate({ children }) {
  const { candidate } = useAuth();
  if (!candidate) return <Navigate to="/login" replace />;
  return children;
}
