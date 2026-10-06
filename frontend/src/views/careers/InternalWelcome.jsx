import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import ProfileStep from '../apply-wizard/ProfileStep';
import { PageTop } from '../../components/workspace/ui';
import { EmploymentForm, PersonalForm } from './forms';
import { CareerShell, WizardRail, useCareer, profileGaps } from './careers';

// First sign-in on Internal Careers (/careers/welcome): the profile in four
// short steps instead of one long form - employment first, since that is
// what HR verifies before shortlisting. The current UCAA job is added to
// work experience from the employment details. Every step saves on
// Continue; the employee can stop and come back.
const STEPS = [
  { label: 'Your UCAA employment', note: 'What HR verifies' },
  { label: 'Personal details', note: 'National ID and where you are from' },
  { label: 'Education and experience', note: 'Used to check you against each job' },
  { label: 'Ready', note: 'Start applying' }
];
const UCAA = 'Uganda Civil Aviation Authority';

export default function InternalWelcome() {
  const navigate = useNavigate();
  const { me, vacancies, fit, reload } = useCareer({ fitFor: 'open' });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = useRef(null);

  // The current job, from the employment details, once - the API ignores an
  // entry it already has (entryDedup), so a second visit adds nothing.
  useEffect(() => {
    if (step !== 2 || !me?.internalProfile?.position || !me.internalProfile.dateJoined) return;
    if ((me.workExperience || []).some((w) => /civil aviation authority|ucaa/i.test(w.employer))) return;
    client.post('/api/candidates/me/work-experience', {
      employer: UCAA, jobTitle: me.internalProfile.position, startDate: me.internalProfile.dateJoined, endDate: null, duties: []
    }).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, me?.internalProfile?.position]);

  if (!me) return <CareerShell active="home"><Skeleton width={260} height={26} /><Skeleton height={320} /></CareerShell>;

  const gaps = profileGaps(me);
  const entriesMissing = [!(me.education || []).length && 'a qualification', !(me.workExperience || []).length && 'a job'].filter(Boolean);
  const open = vacancies || [];
  const canApply = open.filter((v) => fit[v.id]?.eligible).length;

  const next = async () => {
    setError('');
    if (step === 2 && entriesMissing.length) { setError(`Add at least ${entriesMissing.join(' and ')}.`); return; }
    if (save.current && step < 2) {
      setBusy(true);
      const ok = await save.current();
      setBusy(false);
      if (!ok) return;
    }
    await reload();
    setStep(step + 1);
  };

  return (
    <CareerShell active="home">
      <PageTop title={`Welcome, ${(me.fullName || '').split(' ')[0]}`} subtitle="Set up your profile once. Every application is built from it." />
      <div className="ws-wizard">
        <WizardRail steps={STEPS} index={step} onGo={(i) => setStep(i)} />
        <div className="ws-panel">
          <div className="ws-panel-h"><h2>{STEPS[step].label}</h2><span className="ws-note">Step {step + 1} of {STEPS.length}</span></div>
          <div className="ws-panel-b">
            {step === 0 && (
              <>
                <Alert type="info" message="HR checks these details before you can be shortlisted. Your supervisor is told when you submit an application." />
                <EmploymentForm me={me} bind={(fn) => { save.current = fn; }} />
              </>
            )}
            {step === 1 && <PersonalForm me={me} bind={(fn) => { save.current = fn; }} />}
            {step === 2 && (
              <ProfileStep profile={me} onProfileChange={reload} showPersonalDetails={false} profileDetails={{}} setProfileDetail={() => () => {}} />
            )}
            {step === 3 && (
              <div style={{ display: 'grid', gap: 12 }}>
                {gaps.personal.length || gaps.employment ? (
                  <Alert type="warning" message={`Your profile still needs: ${[...(gaps.employment ? ['your employment details'] : []), ...gaps.personal].join(', ')}.`} />
                ) : (
                  <Alert type="success" message={vacancies && Object.keys(fit).length
                    ? `Your profile is ready. You meet the minimum requirements for ${canApply} of the ${open.length} open internal vacanc${open.length === 1 ? 'y' : 'ies'}.`
                    : 'Your profile is ready.'} />
                )}
                <p style={{ margin: 0 }}>
                  When you apply, HR checks your employment details and your supervisor
                  {me.internalProfile?.supervisorName ? `, ${me.internalProfile.supervisorName},` : ''} is told.
                  You can update your profile at any time under My profile.
                </p>
              </div>
            )}
            <Alert type="error" message={error} />
          </div>
          <div className="ws-wfoot">
            <Button variant="ghost" style={{ visibility: step === 0 ? 'hidden' : 'visible' }} onClick={() => { setError(''); setStep(step - 1); }}>Back</Button>
            {step < 3
              ? <Button loading={busy} loadingText="Saving..." onClick={next}>Save and continue</Button>
              : <Button onClick={() => navigate('/careers/vacancies')}>See vacancies</Button>}
          </div>
        </div>
      </div>
    </CareerShell>
  );
}
