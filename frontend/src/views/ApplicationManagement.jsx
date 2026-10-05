import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

// /hr/applications is kept for old links (emails, bookmarks): one vacancy's
// selection now lives on that vacancy's page (VacancyWorkspace.jsx), and the
// cross-vacancy list on Candidates > Applications.
const STAGE_TO_TAB = { pipeline: 'applicants', shortlist: 'committee', interviews: 'interviews', merit: 'merit' };

export default function ApplicationManagement() {
  const [params] = useSearchParams();
  const vacancyId = params.get('vacancyId');
  if (vacancyId) {
    const tab = STAGE_TO_TAB[params.get('stage')] || 'applicants';
    return <Navigate to={`/hr/vacancy/${vacancyId}?tab=${tab}`} replace />;
  }
  return <Navigate to="/hr/candidates?view=applications" replace />;
}
