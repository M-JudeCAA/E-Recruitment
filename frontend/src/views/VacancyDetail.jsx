import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Skeleton from '../components/Skeleton';
import AuditTrail from '../components/AuditTrail';
import Card from '../components/Card';
import { fileLink } from '../utils/fileLink';

// Requisition details with no column of their own on the vacancy - kept in
// the snapshot of what was read (Vacancy.requisitionDetails) and shown here.
const REQUISITION_FACTS = [
  ['excoReference', 'EXCO approval'], ['approvalDate', 'Date of approval'], ['positionStatus', 'Position status'],
  ['jdStatus', 'JD status'], ['contractDuration', 'Contract duration'], ['expectedReportingDate', 'Expected reporting date'],
  ['section', 'Section'], ['directReports', 'No. of direct reports'], ['equipment', 'Required items/equipment']
];
// Form fields as HR knows them, for "changed from the requisition".
const EDITED_LABELS = {
  positionId: 'job title', reportsToPositionId: 'reports to', positionsRequired: 'number of vacancies', postingType: 'posting type',
  salaryScale: 'salary scale', location: 'location', employmentCategory: 'employment category', minimumAge: 'minimum age',
  maximumAge: 'maximum age', jobPurpose: 'job purpose', essentialRequirements: 'essential requirements',
  desirableQualifications: 'desirable requirements', generalKnowledge: 'knowledge', specialSkills: 'special skills'
};

function RequisitionCard({ vacancy }) {
  if (!vacancy.requisitionDocumentUrl) {
    return <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Created before vacancies required an uploaded requisition.</p>;
  }
  const details = vacancy.requisitionDetails || {};
  const fields = details.fields || {};
  const facts = REQUISITION_FACTS.filter(([key]) => fields[key]?.value);
  const edited = (details.editedFields || []).map((k) => EDITED_LABELS[k] || k);
  return (
    <Card style={{ marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Approved requisition</h3>
      <p style={{ margin: '0 0 8px', fontSize: 13 }}>
        <a href={fileLink(vacancy.requisitionDocumentUrl)} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>
          {vacancy.requisitionDocumentName || 'Requisition document'}
        </a>
        {vacancy.requisitionUploadedAt && (
          <span style={{ color: 'var(--color-text-muted)' }}> - uploaded {new Date(vacancy.requisitionUploadedAt).toLocaleDateString()}</span>
        )}
      </p>
      {facts.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {facts.map(([key, label]) => (
              <tr key={key}>
                <td style={{ padding: '2px 12px 2px 0', fontWeight: 600, color: 'var(--color-text-muted)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{label}</td>
                <td style={{ padding: '2px 0', overflowWrap: 'anywhere' }}>{String(fields[key].value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {details.jdException && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-warning)', overflowWrap: 'anywhere' }}>
          Created on a job description that is not approved. Reason given: {details.jdException.reason}
          {details.jdException.authorisedAt
            ? ` - exception authorised ${new Date(details.jdException.authorisedAt).toLocaleDateString()}${details.jdException.authorisedByRole ? ` (${details.jdException.authorisedByRole})` : ''}.`
            : ' - awaiting the approver\'s authorisation.'}
        </p>
      )}
      {edited.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-warning)' }}>
          Changed from the requisition when the vacancy was created: {edited.join(', ')}.
        </p>
      )}
    </Card>
  );
}

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
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoadError('');
    staffClient.get(`/api/vacancies/${id}`)
      .then((res) => setVacancy(res.data))
      // e.g. 409 APPLICANT_CONFLICT: the viewer applied for this vacancy.
      .catch((err) => setLoadError(err.response?.data?.error || 'Could not load this vacancy'));
  }, [id]);

  if (loadError) return <Alert type="error" message={loadError} />;

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

      {vacancy.status === 'Returned' && (
        <Alert type="warning" message={`Returned for revision: ${vacancy.returnReason || 'no comment recorded'}. Edit it and resubmit it for approval from the HR dashboard.`} />
      )}
      {vacancy.status === 'Rejected' && (
        <Alert type="error" message={`Rejected: ${vacancy.rejectionReason || 'no reason recorded'}.`} />
      )}
      {vacancy.status === 'Closed' && vacancy.closeReason && (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Closed: {vacancy.closeReason}</p>
      )}
      {vacancy.status === 'PendingApproval' ? (
        <Alert type="info" message="This vacancy hasn't been approved and published yet, so there are no applications to review. Approve it from the HR dashboard first." />
      ) : ['Returned', 'Rejected'].includes(vacancy.status) ? null : (
        <Button onClick={() => navigate(`/hr/applications?vacancyId=${vacancy.id}`)}>Manage applications &rarr;</Button>
      )}

      <RequisitionCard vacancy={vacancy} />

      <AuditTrail entityType="Vacancy" entityId={vacancy.id} label="Vacancy history" />
    </div>
  );
}
