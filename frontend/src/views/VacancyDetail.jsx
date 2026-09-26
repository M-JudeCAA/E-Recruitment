import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';

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

  if (!vacancy) {
    return (
      <div>
        <Skeleton width={320} height={26} style={{ marginBottom: 10 }} />
        <Skeleton width={220} height={14} style={{ marginBottom: 20 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Skeleton width={90} height={22} radius={999} />
          <Skeleton width={110} height={22} radius={999} />
          <Skeleton width={140} height={14} style={{ alignSelf: 'center' }} />
        </div>
        <Skeleton width={180} height={36} radius={6} />
      </div>
    );
  }

  // vacancy.department is an object ({ name, directorate }, see
  // vacancyModel.findByIdWithDetails' include) - interpolating it directly
  // rendered as the literal string "[object Object]" here before.
  const departmentLabel = vacancy.department?.name
    ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
    : null;
  const deadlinePassed = vacancy.deadline && new Date(vacancy.deadline) < new Date();
  // Only meaningful once this specific vacancy has actually reached Filled
  // (see the schema comment on Vacancy.filledAt) - a vacancy that's merely
  // PartiallyFilled has no fill time to report yet.
  const timeToFillDays = vacancy.filledAt && vacancy.approvedAt
    ? Math.round((new Date(vacancy.filledAt) - new Date(vacancy.approvedAt)) / 86400000)
    : null;

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
        {timeToFillDays != null && (
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Filled in {timeToFillDays} day{timeToFillDays === 1 ? '' : 's'}
          </span>
        )}
      </p>

      {vacancy.status === 'PendingApproval' ? (
        <Alert type="info" message="This vacancy hasn't been approved and published yet, so there are no applications to review. Approve it from the HR dashboard first." />
      ) : (
        <Button onClick={() => navigate(`/hr/applications?vacancyId=${vacancy.id}`)}>Manage applications &rarr;</Button>
      )}
    </div>
  );
}
