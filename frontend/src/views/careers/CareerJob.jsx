import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import VacancyAdvert from '../../components/VacancyAdvert';
import { PageTop, Meta, Panel, Pill } from '../../components/workspace/ui';
import { useVacancyPdfDownload } from '../../utils/useVacancyPdfDownload';
import { evidenceRequirements } from '../../utils/screeningEvidence';
import { orgLabel } from '../../utils/orgNames';
import { SITE, CareerShell, useCareer, formatDay, daysLeft } from './careers';

// One vacancy (Internal Careers: /careers/vacancies/:id; public site, signed
// in: /jobs/:id - guests get JobDetails.jsx): the advert on the left, the
// decision on the right - how the candidate's profile meets each minimum
// (GET /api/applications/eligibility/:id), the documents they will need, the
// closing date and one Apply button. "How to apply" is written for someone
// already signed in.

// The vacancy's minimums, in words, for the "Your fit" list.
const EDUCATION = {
  OLevel: 'O-Level', ALevel: 'A-Level', Certificate: 'A certificate', Diploma: 'A diploma', Bachelors: 'A bachelor’s degree',
  Postgraduate: 'A postgraduate diploma', Masters: 'A master’s degree', PhD: 'A PhD'
};
function minimumsOf(v) {
  return [
    v.minimumEducationLevel && `Education: ${EDUCATION[v.minimumEducationLevel] || v.minimumEducationLevel} or higher`,
    v.minimumExperienceYears ? `Experience: ${v.minimumExperienceYears} year${v.minimumExperienceYears === 1 ? '' : 's'}` : null,
    (v.minimumAge || v.maximumAge) && `Age: ${[v.minimumAge && `${v.minimumAge}+`, v.maximumAge && `${v.maximumAge} or under`].filter(Boolean).join(', ')}`,
    v.minimumCGPA ? `CGPA: ${v.minimumCGPA}` : null,
    v.minimumFlyingHours ? `Flying hours: ${v.minimumFlyingHours}` : null,
    (v.requiredExamGrades || []).length ? 'O/A-Level grades as listed' : null
  ].filter(Boolean);
}

export default function CareerJob() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { applications, me } = useCareer();
  const [vacancy, setVacancy] = useState(null);
  const [fit, setFit] = useState(null);
  const [error, setError] = useState('');
  const pdf = useVacancyPdfDownload();

  useEffect(() => {
    setVacancy(null); setFit(null); setError('');
    client.get(`/api/vacancies/${id}`).then((r) => setVacancy(r.data))
      .catch((err) => setError(err.response?.status === 404
        ? (SITE.internal ? 'This vacancy isn’t open to UCAA employees, or is no longer available.' : 'This job is no longer available.')
        : `Could not load this ${SITE.jobWord}.`));
    client.get(`/api/applications/eligibility/${id}`).then((r) => setFit(r.data)).catch(() => setFit(null));
  }, [id]);

  const mine = (applications || []).find((a) => a.vacancyId === Number(id));
  const left = daysLeft(vacancy?.deadline);
  const closed = left != null && left < 0;
  const supervisor = me?.internalProfile?.supervisorName;

  const needed = evidenceRequirements(vacancy).map((e) => e.label);
  const howToApply = vacancy && (SITE.internal ? (
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
  ) : (
    <div className="ws-advert">
      <h2>How to apply</h2>
      <ol>
        <li>Check your fit on the right. Every application is built from your profile, so keep it up to date.</li>
        <li>Answer a few questions, name three referees and attach your academic documents{needed.length ? ` and ${needed.join(', ').toLowerCase()}` : ''}.</li>
        <li>Submit by 5:00pm on {formatDay(vacancy.deadline)}. Late applications are not accepted.</li>
      </ol>
      <p style={{ marginTop: 10 }}>UCAA never charges a fee to apply. Giving false information is an offence.</p>
    </div>
  ));

  return (
    <CareerShell active="vacancies">
      {error ? <Alert type="error" message={error} /> : !vacancy ? (
        <><Skeleton width={260} height={26} /><Skeleton height={300} /></>
      ) : (
        <>
          <PageTop
            crumb={[{ label: SITE.jobsLabel, to: SITE.jobs }, { label: vacancy.jobRef, mono: true }]}
            title={vacancy.title}
            subtitle={<Meta parts={[
              orgLabel(vacancy.department),
              `${vacancy.positionsRequired} post${vacancy.positionsRequired === 1 ? '' : 's'}`,
              vacancy.deadline && `${closed ? 'Closed' : 'Closes'} ${formatDay(vacancy.deadline)}`
            ]} />}
            actions={<Button variant="secondary" loading={pdf.downloadingId === vacancy.id} loadingText="Preparing..." onClick={() => pdf.download(vacancy)}>Download advert</Button>}
          />
          {pdf.hiddenPrintArea}
          <div className="ws-grid-main">
            <Panel>
              <VacancyAdvert {...vacancy} hideTitle howToApply={howToApply}
                reportsToName={vacancy.reportsToPosition?.name}
                departmentLabel={orgLabel(vacancy.department, ', ') || null} />
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
                  {SITE.internal && <div className="ws-check"><span className="mark ok">✓</span><div><b>UCAA employee</b><div className="d">Internal vacancies are open to you</div></div></div>}
                </div>
                <div className="ws-panel-b" style={{ borderTop: '1px solid var(--color-border)', display: 'grid', gap: 8 }}>
                  {needed.length > 0 && !closed && !(mine && mine.status !== 'Draft') && <div className="ws-note">You will also need: {needed.join('; ')}.</div>}
                  {mine && mine.status !== 'Draft' ? (
                    <>
                      <div className="ws-note">You applied for this {SITE.jobWord}.</div>
                      <Button variant="secondary" onClick={() => navigate(`${SITE.applications}?open=${mine.id}`)}>See your application</Button>
                    </>
                  ) : closed ? (
                    <div className="ws-note">Applications closed on {formatDay(vacancy.deadline)}.</div>
                  ) : fit && !fit.eligible ? (
                    <div className="ws-note">You don’t meet the minimum requirements above, so you can’t apply. If your profile is out of date, <Link to={SITE.profile}>update it</Link>.</div>
                  ) : (
                    <>
                      <Button onClick={() => navigate(SITE.apply(vacancy.id))} style={{ justifyContent: 'center' }}>{mine ? 'Continue your application' : 'Apply'}</Button>
                      {left != null && <div className="ws-note" style={{ textAlign: 'center' }}>{left === 0 ? 'Closes today' : `${left} day${left === 1 ? '' : 's'} left`} · closes {formatDay(vacancy.deadline)}</div>}
                    </>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </CareerShell>
  );
}
