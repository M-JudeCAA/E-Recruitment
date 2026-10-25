import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import PhotoUploadPanel from '../../components/PhotoUploadPanel';
import { PageTop } from '../../components/workspace/ui';
import { EmploymentForm, PersonalForm } from './forms';
import CvImport from './CvImport';
import { SITE, CareerShell, WizardRail, useCareer, profileGaps } from './careers';

// First sign-in, on both sites (Internal Careers /careers/welcome, the
// public site /dashboard/welcome): the profile in a few short steps instead
// of one long form. A UCAA employee starts with their employment, since that
// is what HR verifies before they can apply, and their current UCAA job is
// added to work experience from it; an external candidate starts with their
// personal details (and an optional photo and links). On Education and
// experience a CV can be uploaded to fill the entries in (CvImport, as on My
// profile). Every step saves on Continue; they can stop and come back.
const EMPLOYMENT = { key: 'employment', label: 'Your UCAA employment', note: 'What HR verifies' };
const PERSONAL = { key: 'personal', label: 'Personal details', note: 'Where you are from and live' };
const ENTRIES = { key: 'entries', label: 'Education and experience', note: SITE.internal ? 'Used to check you against each job' : 'Upload your CV to fill it in' };
const READY = { key: 'ready', label: 'Ready', note: SITE.internal ? 'Start applying' : 'Find a job' };
const STEPS = SITE.internal ? [EMPLOYMENT, PERSONAL, ENTRIES, READY] : [PERSONAL, ENTRIES, READY];
const UCAA = 'Uganda Civil Aviation Authority';

export default function Welcome() {
  const navigate = useNavigate();
  const { me, vacancies, fit, reload } = useCareer({ fitFor: 'open' });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = useRef(null);
  const entries = useRef(null);
  const at = STEPS[step].key;

  // The current job, from the employment details, once - the API ignores an
  // entry it already has (entryDedup), so a second visit adds nothing.
  useEffect(() => {
    if (at !== 'entries' || !me?.internalProfile?.position || !me.internalProfile.dateJoined) return;
    if ((me.workExperience || []).some((w) => /civil aviation authority|ucaa/i.test(w.employer))) return;
    client.post('/api/candidates/me/work-experience', {
      employer: UCAA, jobTitle: me.internalProfile.position, startDate: me.internalProfile.dateJoined, endDate: null, duties: []
    }).then(reload).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, me?.internalProfile?.position]);

  if (!me) return <CareerShell active="home"><Skeleton width={260} height={26} /><Skeleton height={320} /></CareerShell>;

  const gaps = profileGaps(me);
  const entriesMissing = (p) => [!(p.education || []).length && 'a qualification', !(p.workExperience || []).length && 'a job'].filter(Boolean);
  const open = vacancies || [];
  const canApply = open.filter((v) => fit[v.id]?.eligible).length;
  const jobWords = SITE.internal ? ['internal vacancy', 'internal vacancies'] : ['open job', 'open jobs'];

  // Education and experience: the entries save themselves; Continue saves
  // what is still waiting (stopping at one left half-filled, which the editor
  // shows) and then checks there is at least a qualification and a job.
  const entriesDone = async () => {
    setBusy(true);
    try {
      if (entries.current && !(await entries.current.finish())) {
        setError('An entry is missing something it needs - fill it in or remove it.');
        return false;
      }
      const missing = entriesMissing((await client.get('/api/candidates/me')).data);
      if (missing.length) { setError(`Add at least ${missing.join(' and ')}.`); return false; }
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not check your entries');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    setError('');
    if (at === 'entries' && !(await entriesDone())) return;
    if (save.current && (at === 'employment' || at === 'personal')) {
      setBusy(true);
      const ok = await save.current();
      setBusy(false);
      if (!ok) return;
    }
    await reload();
    setStep(step + 1);
  };

  const still = [...(gaps.employment ? ['your employment details'] : []), ...gaps.personal];

  return (
    <CareerShell active="home">
      <PageTop title={`Welcome, ${(me.fullName || '').split(' ')[0]}`} subtitle="Set up your profile once. Every application is built from it." />
      <div className="ws-wizard">
        <WizardRail steps={STEPS} index={step} onGo={(i) => setStep(i)} />
        <div className="ws-panel">
          <div className="ws-panel-h"><h2>{STEPS[step].label}</h2><span className="ws-note">Step {step + 1} of {STEPS.length}</span></div>
          <div className="ws-panel-b">
            {at === 'employment' && (
              <>
                <Alert type="info" message="HR checks these details before you can apply for a vacancy." />
                <EmploymentForm me={me} bind={(fn) => { save.current = fn; }} />
              </>
            )}
            {at === 'personal' && (
              <>
                {!SITE.internal && <PhotoUploadPanel photoUrl={me.photoUrl} onChange={() => reload()} />}
                <PersonalForm me={me} links={!SITE.internal} bind={(fn) => { save.current = fn; }} />
              </>
            )}
            {at === 'entries' && (
              <>
                <p className="ws-note" style={{ marginTop: 0 }}>Have a CV? Upload it and your education and jobs are filled in for you - then check each one. Or add them by hand below.</p>
                <CvImport profile={me} onAdded={reload} entriesRef={entries} links={!SITE.internal} />
              </>
            )}
            {at === 'ready' && (
              <div style={{ display: 'grid', gap: 12 }}>
                {still.length ? (
                  <Alert type="warning" message={`Your profile still needs: ${still.join(', ')}.`} />
                ) : (
                  <Alert type="success" message={vacancies && Object.keys(fit).length
                    ? `Your profile is ready. You meet the minimum requirements for ${canApply} of the ${open.length} ${open.length === 1 ? jobWords[0] : jobWords[1]}.`
                    : 'Your profile is ready.'} />
                )}
                <p style={{ margin: 0 }}>
                  {SITE.internal && 'HR checks your employment details before you can apply. '}
                  You can update your profile at any time under My profile.
                </p>
              </div>
            )}
            <Alert type="error" message={error} />
          </div>
          <div className="ws-wfoot">
            <Button variant="ghost" style={{ visibility: step === 0 ? 'hidden' : 'visible' }} onClick={() => { setError(''); setStep(step - 1); }}>Back</Button>
            {at !== 'ready'
              ? <Button loading={busy} loadingText="Saving..." onClick={next}>Save and continue</Button>
              : <Button onClick={() => navigate(SITE.jobs)}>{SITE.internal ? 'See vacancies' : 'Find jobs'}</Button>}
          </div>
        </div>
      </div>
    </CareerShell>
  );
}
