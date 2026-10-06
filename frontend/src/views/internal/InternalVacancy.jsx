import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import VacancyAdvert from '../../components/VacancyAdvert';
import { PageTop, Meta, Panel, Pill } from '../../components/workspace/ui';
import { InternalShell, useCareer, formatDay, daysLeft } from './careers';

// One internal vacancy (/careers/vacancies/:id): the advert on the left, the
// decision on the right - how the employee's profile meets each minimum
// (GET /api/applications/eligibility/:id), the closing date and one Apply
// button. "How to apply" is written for staff.

// The vacancy's minimums, in words, for the "Your fit" list.
function minimumsOf(v) {
  return [
    v.minimumEducationLevel && `Education: ${v.minimumEducationLevel} or higher`,
    v.minimumExperienceYears ? `Experience: ${v.minimumExperienceYears} year${v.minimumExperienceYears === 1 ? '' : 's'}` : null,
    (v.minimumAge || v.maximumAge) && `Age: ${[v.minimumAge && `${v.minimumAge}+`, v.maximumAge && `${v.maximumAge} or under`].filter(Boolean).join(', ')}`,
    v.minimumCGPA ? `CGPA: ${v.minimumCGPA}` : null,
    v.minimumFlyingHours ? `Flying hours: ${v.minimumFlyingHours}` : null,
    (v.requiredExamGrades || []).length ? 'O/A-Level grades as listed' : null
  ].filter(Boolean);
}

export default function InternalVacancy() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { applications, me } = useCareer();
  const [vacancy, setVacancy] = useState(null);
  const [fit, setFit] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setVacancy(null); setFit(null); setError('');
    client.get(`/api/vacancies/${id}`).then((r) => setVacancy(r.data))
      .catch((err) => setError(err.response?.status === 404 ? 'This vacancy isn’t open to UCAA employees, or is no longer available.' : 'Could not load this vacancy.'));
    client.get(`/api/applications/eligibility/${id}`).then((r) => setFit(r.data)).catch(() => setFit(null));
  }, [id]);

  const mine = (applications || []).find((a) => a.vacancyId === Number(id));
  const left = daysLeft(vacancy?.deadline);
  const closed = left != null && left < 0;
  const supervisor = me?.internalProfile?.supervisorName;

  const howToApply = vacancy && (
    <div className="ws-advert">
      <h2>How to apply</h2>
      <ol>
        <li>You are signed in with your UCAA account, so there is nothing to register.</li>
        <li>Check your profile is up to date. The application only asks for what this vacancy needs.</li>
        <li>Confirm your employment details. HR verifies them before shortlisting.</li>
        <li>Answer the questions, name three referees, add your academic documents, and submit by 5:00pm on {formatDay(vacancy.deadline)}.</li>
        <li>Your supervisor{supervisor ? `, ${supervisor},` : ''} is told that you have applied.</li>
      </ol>
    </div>
  );

  return (
    <InternalShell active="vacancies">
      {error ? <Alert type="error" message={error} /> : !vacancy ? (
        <><Skeleton width={260} height={26} /><Skeleton height={300} /></>
      ) : (
        <>
          <PageTop
            crumb={[{ label: 'Vacancies', to: '/careers/vacancies' }, { label: vacancy.jobRef, mono: true }]}
            title={vacancy.title}
            subtitle={<Meta parts={[
              vacancy.department?.name && `${vacancy.department.name}${vacancy.department.directorate?.name ? `, ${vacancy.department.directorate.name}` : ''}`,
              `${vacancy.positionsRequired} post${vacancy.positionsRequired === 1 ? '' : 's'}`,
              vacancy.deadline && `${closed ? 'Closed' : 'Closes'} ${formatDay(vacancy.deadline)}`
            ]} />}
          />
          <div className="ws-grid-main">
            <Panel>
              <VacancyAdvert {...vacancy} hideTitle howToApply={howToApply}
                reportsToName={vacancy.reportsToPosition?.name}
                departmentLabel={vacancy.department?.name ? `${vacancy.department.name}${vacancy.department.directorate?.name ? `, ${vacancy.department.directorate.name}` : ''}` : null} />
            </Panel>
            <div className="ws-sticky">
              <Panel padded={false} title="Your fit"
                actions={fit && (fit.eligible ? <Pill tone="ok">You can apply</Pill> : <Pill tone="neutral">Not eligible</Pill>)}>
                <div className="ws-panel-b" style={{ paddingBlock: 4 }}>
                  {!fit && <div className="ws-note" style={{ padding: '10px 0' }}>Checking your profile…</div>}
                  {fit && fit.eligible && (minimumsOf(vacancy).length ? minimumsOf(vacancy) : ['No minimum requirements set']).map((m) => (
                    <div key={m} className="ws-check"><span className="mark ok">✓</span><div><b>{m}</b></div></div>
                  ))}
                  {fit && !fit.eligible && fit.reasons.map((r) => (
                    <div key={r} className="ws-check"><span className="mark bad">✕</span><div><b>{r}</b></div></div>
                  ))}
                  <div className="ws-check"><span className="mark ok">✓</span><div><b>UCAA employee</b><div className="d">Internal vacancies are open to you</div></div></div>
                </div>
                <div className="ws-panel-b" style={{ borderTop: '1px solid var(--color-border)', display: 'grid', gap: 8 }}>
                  {mine && mine.status !== 'Draft' ? (
                    <>
                      <div className="ws-note">You applied for this vacancy.</div>
                      <Button variant="secondary" onClick={() => navigate(`/careers/applications?open=${mine.id}`)}>See your application</Button>
                    </>
                  ) : closed ? (
                    <div className="ws-note">Applications closed on {formatDay(vacancy.deadline)}.</div>
                  ) : fit && !fit.eligible ? (
                    <div className="ws-note">You don’t meet the minimum requirements above, so you can’t apply. If your profile is out of date, <Link to="/careers/profile">update it</Link>.</div>
                  ) : (
                    <>
                      <Button onClick={() => navigate(`/careers/apply/${vacancy.id}`)} style={{ justifyContent: 'center' }}>{mine ? 'Continue your application' : 'Apply'}</Button>
                      {left != null && <div className="ws-note" style={{ textAlign: 'center' }}>{left === 0 ? 'Closes today' : `${left} day${left === 1 ? '' : 's'} left`} · closes {formatDay(vacancy.deadline)}</div>}
                    </>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </InternalShell>
  );
}
