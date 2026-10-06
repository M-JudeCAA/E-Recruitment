import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import QuestionsStep from '../apply-wizard/QuestionsStep';
import RefereesStep from '../apply-wizard/RefereesStep';
import DocumentsStep from '../apply-wizard/DocumentsStep';
import ReviewStep from '../apply-wizard/ReviewStep';
import SubmitStep from '../apply-wizard/SubmitStep';
import { PageTop, Meta } from '../../components/workspace/ui';
import { failedDisqualifyingRequirements } from '../../utils/screeningQuestions';
import { evidenceRequirements, missingEvidence } from '../../utils/screeningEvidence';
import { EmploymentForm } from './forms';
import { InternalShell, WizardRail, profileGaps, formatDay } from './careers';

// Applying on Internal Careers (/careers/apply/:vacancyId): the same draft,
// documents and submit API as the public apply wizard (ApplyForm.jsx), in
// six short steps. The profile isn't re-typed: Check only lists what this
// vacancy needs that the profile lacks. Employment details come filled in
// for confirmation - HR verifies them, and changing them sends them back to
// HR (candidateController.updateInternalProfile).
const STEPS = [
  { key: 'check', label: 'Check', note: 'What this vacancy needs' },
  { key: 'employment', label: 'Employment', note: 'Confirm your details' },
  { key: 'questions', label: 'Questions', note: 'A few specifics' },
  { key: 'referees', label: 'Referees', note: 'Three people' },
  { key: 'documents', label: 'Documents', note: 'Certificates and evidence' },
  { key: 'submit', label: 'Review and submit', note: '' }
];
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i]));
const emptyReferee = { name: '', relationship: '', organization: '', phone: '', email: '' };

// A requirement's answerType decides how its form value is read (see ApplyForm.jsx).
function parseAnswer(requirements, id, raw) {
  const req = (requirements || []).find((r) => r.id === id);
  if (req?.answerType === 'number') return raw === '' ? undefined : Number(raw);
  return raw === 'Yes';
}
const answersOf = (list) => Object.fromEntries((list || []).map((r) => [r.id, r.answer]));
const toList = (answers) => Object.entries(answers)
  .filter(([, a]) => typeof a === 'boolean' || (typeof a === 'number' && Number.isFinite(a)))
  .map(([id, answer]) => ({ id, answer }));

export default function InternalApply() {
  const { vacancyId } = useParams();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState(null);
  const [me, setMe] = useState(null);
  const [application, setApplication] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [eligibility, setEligibility] = useState(null);
  const [questions, setQuestions] = useState({ desiredSalary: '', openToRelocate: '', earliestStartDate: '', whyThisRole: '' });
  const [desirable, setDesirable] = useState({});
  const [disqualifying, setDisqualifying] = useState({});
  const [referees, setReferees] = useState([{ ...emptyReferee }, { ...emptyReferee }, { ...emptyReferee }]);
  const [coverLetter, setCoverLetter] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [employmentOk, setEmploymentOk] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const saveEmployment = useRef(null);

  const loadMe = () => client.get('/api/candidates/me').then((r) => setMe(r.data));
  useEffect(() => {
    client.get(`/api/vacancies/${vacancyId}`).then((r) => setVacancy(r.data))
      .catch((err) => setLoadError(err.response?.status === 404 ? 'This vacancy isn’t open to UCAA employees, or is no longer available.' : 'Could not load this vacancy.'));
    loadMe();
    client.get('/api/candidates/me/applications').then((r) => {
      const existing = r.data.find((a) => a.vacancyId === Number(vacancyId));
      if (existing) {
        setApplication(existing);
        setQuestions({
          desiredSalary: existing.desiredSalary || '', openToRelocate: existing.openToRelocate || '',
          earliestStartDate: existing.earliestStartDate ? existing.earliestStartDate.slice(0, 10) : '', whyThisRole: existing.whyThisRole || ''
        });
        setDesirable(answersOf(existing.desirableResponses));
        setDisqualifying(answersOf(existing.disqualifyingResponses));
        setReferees([0, 1, 2].map((i) => ({ ...emptyReferee, ...(existing.referees || [])[i] })));
        setDocuments(existing.documents || []);
        if (existing.status !== 'Draft') setStep(STEP_INDEX.submit);
      }
      setLoaded(true);
    });
  }, [vacancyId]);

  const stepKey = STEPS[step].key;
  useEffect(() => {
    if (!['check', 'submit'].includes(stepKey) || (application && application.status !== 'Draft')) return;
    client.get(`/api/applications/eligibility/${vacancyId}`).then((r) => setEligibility(r.data)).catch(() => setEligibility(null));
  }, [vacancyId, stepKey, application?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveDraft = async () => {
    const form = new FormData();
    form.append('vacancyId', vacancyId);
    if (coverLetter) form.append('coverLetter', coverLetter);
    Object.entries(questions).forEach(([k, v]) => form.append(k, v));
    form.append('desirableResponses', JSON.stringify(toList(desirable)));
    form.append('disqualifyingResponses', JSON.stringify(toList(disqualifying)));
    form.append('referees', JSON.stringify(referees));
    const res = await client.post('/api/applications', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    setApplication(res.data);
  };

  if (loadError) return <InternalShell active="vacancies"><Alert type="error" message={loadError} /><Link to="/careers/vacancies">Back to vacancies</Link></InternalShell>;
  if (!vacancy || !me || !loaded) return <InternalShell active="vacancies"><Skeleton width={300} height={26} /><Skeleton height={360} /></InternalShell>;

  const decided = application && application.status !== 'Draft';
  const closed = vacancy.deadline && new Date(vacancy.deadline) < new Date();
  if (closed && !decided) {
    return (
      <InternalShell active="vacancies">
        <PageTop title="Applications closed" subtitle={`${vacancy.title} closed on ${formatDay(vacancy.deadline)}.`} />
        <div className="ws-panel ws-empty">{application ? 'Your draft is kept under My applications, but it can no longer be sent.' : 'This vacancy no longer accepts applications.'}</div>
      </InternalShell>
    );
  }

  const gaps = profileGaps(me);
  const evidence = evidenceRequirements(vacancy, { ...desirable, ...disqualifying });
  const failedQuestions = failedDisqualifyingRequirements(vacancy.disqualifyingRequirements, disqualifying);
  const missing = {
    check: gaps.personal,
    employment: employmentOk ? [] : ['Tick “These details are correct”'],
    questions: [
      !questions.openToRelocate && 'Open to relocating?', !questions.whyThisRole?.trim() && 'Why this role?',
      ...(vacancy.desirableRequirements || []).filter((r) => desirable[r.id] === undefined).map((r) => r.text),
      ...(vacancy.disqualifyingRequirements || []).filter((r) => disqualifying[r.id] === undefined).map((r) => r.text)
    ].filter(Boolean),
    referees: referees.flatMap((r, i) => (!r.name || !r.phone || !r.email ? [`Referee ${i + 1} (name, phone, email)`] : [])),
    documents: [
      ...(documents.some((d) => d.category === 'Academic') ? [] : ['At least one academic document']),
      ...missingEvidence(evidence, documents).map((e) => e.label)
    ],
    submit: []
  }[stepKey];

  const next = async () => {
    setError('');
    if (missing.length || (stepKey === 'questions' && failedQuestions.length)) return;
    setBusy(true);
    try {
      if (stepKey === 'employment' && saveEmployment.current && !(await saveEmployment.current())) return;
      if (!decided) await saveDraft();
      if (stepKey === 'employment') await loadMe();
      setStep(step + 1);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your application');
    } finally {
      setBusy(false);
    }
  };

  const supervisor = me.internalProfile?.supervisorName;
  return (
    <InternalShell active="vacancies">
      <PageTop
        crumb={[{ label: 'Vacancies', to: '/careers/vacancies' }, { label: vacancy.title, to: `/careers/vacancies/${vacancy.id}` }, { label: 'Application' }]}
        title={`Apply: ${vacancy.title}`}
        subtitle={<Meta parts={[<span className="ws-mono">{vacancy.jobRef}</span>, vacancy.deadline && `Closes ${formatDay(vacancy.deadline)}`, !decided && 'Saved as you go']} />}
        actions={!decided && <Button variant="ghost" onClick={async () => { setBusy(true); try { await saveDraft(); } catch { /* shown on next save */ } setBusy(false); navigate('/careers/applications'); }}>Save and exit</Button>}
      />
      <div className="ws-wizard">
        <WizardRail steps={STEPS} index={step} onGo={decided ? null : (i) => setStep(i)} />
        <div className="ws-panel">
          <div className="ws-panel-h"><h2>{STEPS[step].label}</h2><span className="ws-note">Step {step + 1} of {STEPS.length}</span></div>
          <div className="ws-panel-b" style={{ display: 'grid', gap: 14 }}>
            {stepKey === 'check' && (
              <>
                {gaps.personal.length > 0 && (
                  <Alert type="warning" message={<>Your profile needs {gaps.personal.join(', ').toLowerCase()} before you can apply. <Link to="/careers/profile">Update your profile</Link>, then come back.</>} />
                )}
                {eligibility && !eligibility.eligible && eligibility.reasons.length > 0 && (
                  <Alert type="warning" message={<>Based on your profile you don’t meet: {eligibility.reasons.join('; ')}. You won’t be able to submit unless your profile shows you do.</>} />
                )}
                {eligibility?.eligible && gaps.personal.length === 0 && <Alert type="success" message="Your profile meets this vacancy’s minimum requirements." />}
                <div>
                  {evidence.length > 0 ? evidence.map((e) => (
                    <div key={e.key} className="ws-check"><span className="mark miss">!</span><div><b>{e.label}</b><div className="d">This vacancy asks for it. You add it on the Documents step.</div></div></div>
                  )) : <div className="ws-note">Besides your academic documents, this vacancy asks for no extra evidence so far.</div>}
                </div>
              </>
            )}
            {stepKey === 'employment' && (
              <>
                <Alert type="info" message={`HR verifies these details before shortlisting.${supervisor ? ` ${supervisor}, your supervisor,` : ' Your supervisor'} is told when you submit.`} />
                <EmploymentForm me={me} bind={(fn) => { saveEmployment.current = fn; }} />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={employmentOk} onChange={(e) => setEmploymentOk(e.target.checked)} /> These details are correct
                </label>
              </>
            )}
            {stepKey === 'questions' && (
              <QuestionsStep questions={questions} vacancyLocation={vacancy.location}
                set={(k) => (e) => setQuestions({ ...questions, [k]: e.target.value })}
                desirableRequirements={vacancy.desirableRequirements} desirableAnswers={desirable}
                setDesirableAnswer={(id) => (e) => setDesirable({ ...desirable, [id]: parseAnswer(vacancy.desirableRequirements, id, e.target.value) })}
                disqualifyingRequirements={vacancy.disqualifyingRequirements} disqualifyingAnswers={disqualifying}
                setDisqualifyingAnswer={(id) => (e) => setDisqualifying({ ...disqualifying, [id]: parseAnswer(vacancy.disqualifyingRequirements, id, e.target.value) })} />
            )}
            {stepKey === 'referees' && (
              <RefereesStep referees={referees}
                setReferee={(i, k) => (e) => setReferees(referees.map((r, idx) => (idx === i ? { ...r, [k]: e.target.value } : r)))} />
            )}
            {stepKey === 'documents' && (
              <DocumentsStep coverLetter={coverLetter} setCoverLetter={setCoverLetter} applicationId={application?.id}
                documents={documents} onDocumentsChange={setDocuments} evidence={evidence}
                portfolioUrl={me.portfolioUrl || ''} setPortfolioUrl={() => {}} />
            )}
            {stepKey === 'submit' && (
              <>
                {!decided && (
                  <ReviewStep profile={me} coverLetter={coverLetter} documents={documents} referees={referees} vacancy={vacancy} evidence={evidence}
                    profileDetails={me} questions={questions} internalProfile={me.internalProfile || {}} candidateType="Internal"
                    goTo={(i) => setStep(i)} stepIndexes={{ profile: STEP_INDEX.check, documents: STEP_INDEX.documents, referees: STEP_INDEX.referees, questions: STEP_INDEX.questions, internal: STEP_INDEX.employment }}
                    desirableRequirements={vacancy.desirableRequirements} desirableAnswers={desirable}
                    disqualifyingRequirements={vacancy.disqualifyingRequirements} disqualifyingAnswers={disqualifying} />
                )}
                <SubmitStep vacancy={vacancy} applicationId={application?.id} status={application?.status} eligibility={eligibility}
                  goToStep={(k) => setStep(STEP_INDEX[k] ?? STEP_INDEX.documents)}
                  onSubmitted={() => setApplication({ ...application, status: 'Submitted' })}
                  onWithdrawn={() => navigate('/careers/applications')} />
                {!decided && <div className="ws-note">After you submit, HR checks your employment details{supervisor ? ` and ${supervisor} is told` : ''}. Follow progress under My applications.</div>}
              </>
            )}
            {missing.length > 0 && stepKey !== 'check' && <div className="ws-note" style={{ color: 'var(--color-danger)' }}>Before continuing, please complete: {missing.join(', ')}</div>}
            {stepKey === 'questions' && failedQuestions.length > 0 && (
              <div className="ws-note" style={{ color: 'var(--color-danger)' }}>
                You are not eligible for this role because of your answer to: {failedQuestions.map((r) => `“${r.text}”`).join(', ')}. If you answered by mistake, change your answer.
              </div>
            )}
            <Alert type="error" message={error} />
          </div>
          {stepKey !== 'submit' && (
            <div className="ws-wfoot">
              <Button variant="ghost" onClick={() => (step === 0 ? navigate(`/careers/vacancies/${vacancy.id}`) : setStep(step - 1))}>{step === 0 ? 'Back to the advert' : 'Back'}</Button>
              <Button loading={busy} loadingText="Saving..." disabled={missing.length > 0 || (stepKey === 'questions' && failedQuestions.length > 0)} onClick={next}>Continue</Button>
            </div>
          )}
          {stepKey === 'submit' && decided && (
            <div className="ws-wfoot"><span /><Button variant="secondary" onClick={() => navigate('/careers/applications')}>Go to My applications</Button></div>
          )}
        </div>
      </div>
    </InternalShell>
  );
}
