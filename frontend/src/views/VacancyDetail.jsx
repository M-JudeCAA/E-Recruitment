import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';

// Vacancy-info only - the applicant review workflow (screening, shortlist
// ranking, verification, reject, interview scheduling/scoring, offer
// actions) that used to live entirely on this page now lives on
// ApplicationManagement.jsx, which this hands off to. See that file's own
// comment for why: HR needs to work applications across vacancies, not
// just one at a time, and this page has nothing useful to add to that flow
// beyond a link into it.
export default function VacancyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState(null);

  useEffect(() => {
    staffClient.get(`/api/vacancies/${id}`).then((res) => setVacancy(res.data));
  }, [id]);

  if (!vacancy) return <p>Loading...</p>;

  // vacancy.department is an object ({ name, directorate }, see
  // vacancyModel.findByIdWithDetails' include) - interpolating it directly
  // rendered as the literal string "[object Object]" here before.
  const departmentLabel = vacancy.department?.name
    ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
    : null;
  const deadlinePassed = vacancy.deadline && new Date(vacancy.deadline) < new Date();

  return (
    <div>
      <PageHeader
        title={vacancy.title}
        subtitle={`${departmentLabel ? departmentLabel + ' · ' : ''}${vacancy.positionsRequired} position(s) required`}
      />
      <p style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {vacancy.readvertisedFromId != null && <StatusBadge status="Readvertised" />}
        <StatusBadge status={vacancy.status} />
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{vacancy.postingType} posting</span>
        {vacancy.deadline && (
          <span style={{ fontSize: 13, color: deadlinePassed ? 'var(--color-danger)' : 'var(--color-text-muted)', fontWeight: deadlinePassed ? 600 : 400 }}>
            {deadlinePassed ? 'Deadline passed' : 'Deadline'}: {new Date(vacancy.deadline).toLocaleDateString()}
          </span>
        )}
        {vacancy.salaryScale && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Salary scale: {vacancy.salaryScale}</span>}
      </p>

      {vacancy.status === 'PendingApproval' ? (
        <Alert type="info" message="This vacancy hasn't been approved and published yet, so there are no applications to review. Approve it from the HR dashboard first." />
      ) : (
        <Button onClick={() => navigate(`/hr/applications?vacancyId=${vacancy.id}`)}>Manage applications &rarr;</Button>
      )}
    </div>
  );
}
