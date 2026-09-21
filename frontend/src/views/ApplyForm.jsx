import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingState from '../components/LoadingState';
import Modal from '../components/Modal';
import ProfileCompletionForm from '../components/ProfileCompletionForm';
import { isProfileComplete } from '../utils/profileCompleteness';
import ucaaLogo from '../assets/ucaa-logo.png';
import StepperRail from './apply-wizard/StepperRail';
import JobDetailsStep from './apply-wizard/JobDetailsStep';
import ProfileStep from './apply-wizard/ProfileStep';
import DocumentsStep from './apply-wizard/DocumentsStep';
import RefereesStep from './apply-wizard/RefereesStep';
import QuestionsStep from './apply-wizard/QuestionsStep';
import InternalProfileStep from './apply-wizard/InternalProfileStep';
import ReviewStep from './apply-wizard/ReviewStep';
import SubmitStep from './apply-wizard/SubmitStep';

// A requirement's answerType (see ScreeningQuestionsEditor.jsx) decides how
// its raw form-control value should be read: a 'number' row's TextField
// hands back a numeric string (or '' when cleared, treated as "not
// answered yet" the same way an unselected Select is), everything else is
// a Select whose value is the literal string 'Yes'/'No'.
function parseRequirementAnswer(requirements, id, rawValue) {
  const req = (requirements || []).find((r) => r.id === id);
  if (req?.answerType === 'number') return rawValue === '' ? undefined : Number(rawValue);
  return rawValue === 'Yes';
}

// /apply/:vacancyId is a full-bleed route with no Navbar (see App.jsx's
// PaddedLayout split) - without this, there is no way to leave the wizard
// at all short of the browser's own back button or closing the tab.
// onSaveExit is omitted on the loading/deadline-blocked screens, which
// have nothing of the candidate's to save yet (deadline-blocked already
// offers its own "Browse open positions"/"View my applications" links).
function WizardExitHeader({ candidate, onSaveExit, saving }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
      <Link to={candidate ? '/dashboard' : '/'} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, flexShrink: 0, borderRadius: 7, background: '#FFFFFF', padding: 3, boxSizing: 'border-box' }}>
          <img src={ucaaLogo} alt="UCAA logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary-dark)' }}>UCAA e-Recruitment</span>
      </Link>
      {onSaveExit && (
        <button type="button" onClick={onSaveExit} disabled={saving}
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary-dark)', background: 'none', border: 'none', cursor: saving ? 'default' : 'pointer' }}>
          {saving ? 'Saving...' : 'Save & exit'}
        </button>
      )}
    </div>
  );
}

export default function ApplyForm() {
  const { vacancyId } = useParams();
  const { candidate } = useAuth();
  const navigate = useNavigate();

  const [vacancy, setVacancy] = useState(null);
  const [profile, setProfile] = useState(null);
  const [application, setApplication] = useState(null);
  // Candidate-level fields (persist across every application) - National ID,
  // location, work authorization, LinkedIn/portfolio links. Separate from
  // internalProfileForm below, which is Internal-candidate-only.
  const [profileDetailsForm, setProfileDetailsForm] = useState({
    nationalId: '', location: '', workAuthorization: '', linkedinUrl: '', portfolioUrl: '',
    dateOfBirth: '', flyingHours: ''
  });
  const [internalProfileForm, setInternalProfileForm] = useState({});
  // Application-level fields (vary per application) - the Questions step.
  const [questionsForm, setQuestionsForm] = useState({
    desiredSalary: '', openToRelocate: '', earliestStartDate: '', whyThisRole: ''
  });
  // Answers to the vacancy's Desirable Requirements questions - kept as
  // { [requirementId]: true | false | number }, one key per question the
  // candidate has actually answered so far (boolean for a Yes/No row,
  // number for a 'number' row - see parseRequirementAnswer above).
  // Converted to the [{id, answer, ...}] array the backend expects only at
  // save time (see saveDraft).
  const [desirableAnswers, setDesirableAnswers] = useState({});
  // Same shape/lifecycle as desirableAnswers above, for the vacancy's
  // mandatory eligibility (disqualifying) questions - see
  // Vacancy.disqualifyingRequirements.
  const [disqualifyingAnswers, setDisqualifyingAnswers] = useState({});
  // Fixed 3-slot array (never fewer, never more) - see RefereesStep.jsx.
  // Application-level, same lifecycle as questionsForm/desirableAnswers
  // below - loaded from an existing draft's referees if one exists,
  // otherwise starts empty.
  const emptyReferee = { name: '', relationship: '', organization: '', phone: '', email: '' };
  const [refereesForm, setRefereesForm] = useState([{ ...emptyReferee }, { ...emptyReferee }, { ...emptyReferee }]);
  const [coverLetter, setCoverLetter] = useState(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState({ 0: true });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // True once any field has been edited since the last successful save -
  // drives the beforeunload warning below. Set explicitly by each field's
  // onChange wrapper (not inferred from a blanket state-change watcher),
  // since loadProfile/the existing-draft load below also populate this same
  // state on mount and would otherwise be indistinguishable from a real edit.
  const [dirty, setDirty] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Disables Continue while its own save(s) are in flight - awaiting them
  // before calling next() means a real double-click can't fire a second
  // overlapping saveDraft() call while the first is still pending (the
  // backend also tolerates this - see the P2002 fallback in
  // applicationDraftController.saveDraft - but not firing the duplicate
  // request in the first place is cleaner than relying on that alone).
  const [continuing, setContinuing] = useState(false);

  // Advert User path: a candidate who arrived here via a pending
  // returnTo (see CandidateLogin.jsx/ProtectedRoute.jsx) sees a closable
  // profile-completion modal over this page instead of the dashboard or
  // the standalone /profile/complete page - the wizard underneath stays
  // mounted and visible either way.
  const [showProfileModal, setShowProfileModal] = useState(false);
  // True once the /me/applications lookup below has resolved (whether or
  // not it found a match) - needed so the deadline-passed screen render
  // check further down never fires on a false negative while that request
  // is still in flight (which would otherwise briefly block a candidate
  // who actually already has a Draft/Submitted application here).
  const [applicationsChecked, setApplicationsChecked] = useState(false);

  const loadProfile = () => client.get('/api/candidates/me').then((res) => {
    setProfile(res.data);
    setProfileDetailsForm({
      nationalId: res.data.nationalId || '',
      location: res.data.location || '',
      workAuthorization: res.data.workAuthorization || '',
      linkedinUrl: res.data.linkedinUrl || '',
      portfolioUrl: res.data.portfolioUrl || '',
      dateOfBirth: res.data.dateOfBirth ? res.data.dateOfBirth.slice(0, 10) : '',
      flyingHours: res.data.flyingHours ?? ''
    });
    // CHANGED - dateJoined is a full ISO datetime string from the server,
    // but InternalProfileStep's field is a native <input type="date">,
    // which silently renders blank for anything but an exact YYYY-MM-DD
    // value. A returning internal candidate (continuing a draft, or
    // applying to a second vacancy) previously saw an empty date here even
    // though it was already on file - same .slice(0, 10) fix already
    // applied to dateOfBirth above.
    if (res.data.internalProfile) {
      setInternalProfileForm({
        ...res.data.internalProfile,
        dateJoined: res.data.internalProfile.dateJoined ? res.data.internalProfile.dateJoined.slice(0, 10) : ''
      });
    }
    if (!isProfileComplete(res.data)) setShowProfileModal(true);
  });

  useEffect(() => {
    client.get(`/api/vacancies/${vacancyId}`).then((res) => setVacancy(res.data));
    loadProfile();
    client.get('/api/candidates/me/applications').then((res) => {
      const existing = res.data.find((a) => a.vacancyId === Number(vacancyId));
      if (existing) {
        setApplication(existing);
        setQuestionsForm({
          desiredSalary: existing.desiredSalary || '',
          openToRelocate: existing.openToRelocate || '',
          earliestStartDate: existing.earliestStartDate ? existing.earliestStartDate.slice(0, 10) : '',
          whyThisRole: existing.whyThisRole || ''
        });
        setDesirableAnswers(
          Object.fromEntries((existing.desirableResponses || []).map((r) => [r.id, r.answer]))
        );
        setDisqualifyingAnswers(
          Object.fromEntries((existing.disqualifyingResponses || []).map((r) => [r.id, r.answer]))
        );
        // Padded back out to exactly 3 slots regardless of how many were
        // actually saved (a candidate who left the step early may have
        // saved a draft with fewer than 3) - RefereesStep always renders
        // 3 fixed slots.
        const savedReferees = existing.referees || [];
        setRefereesForm([0, 1, 2].map((i) => ({ ...emptyReferee, ...savedReferees[i] })));
      }
      setApplicationsChecked(true);
    });
  }, [vacancyId]);

  // Warns before an accidental tab close/navigation-away drops unsaved
  // edits - "Save as draft"/Continue/"Save & exit" all clear `dirty` on a
  // successful save, so this only fires when there's genuinely something
  // not yet persisted. Native browsers ignore the custom message text and
  // show their own generic prompt; setting returnValue is what triggers it.
  useEffect(() => {
    const handler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const steps = [
    { key: 'jobDetails', label: 'Job Details', note: 'About this role' },
    { key: 'profile', label: 'Profile', note: 'Who you are' },
    { key: 'documents', label: 'Documents', note: 'Cover letter & links' },
    { key: 'referees', label: 'Referees', note: '3 references' },
    { key: 'questions', label: 'Questions', note: 'A few specifics' },
    ...(candidate?.candidateType === 'Internal'
      ? [{ key: 'internal', label: 'Internal Profile', note: 'Employment details' }]
      : []),
    { key: 'review', label: 'Review', note: 'Check it over' },
    { key: 'submit', label: 'Submit', note: 'Send it in' },
  ];
  const stepIndexes = Object.fromEntries(steps.map((s, i) => [s.key, i]));

  const goTo = (i) => { setVisited((v) => ({ ...v, [i]: true })); setStepIndex(i); };
  const next = () => goTo(Math.min(stepIndex + 1, steps.length - 1));
  const back = () => goTo(Math.max(stepIndex - 1, 0));
  const isComplete = (i) => i < stepIndex || (i === steps.length - 1 && ['Submitted', 'UnderReview'].includes(application?.status));

  // What's missing before Continue is allowed to advance past this step -
  // returns a list of human-readable field names, empty when the step is
  // satisfied. Gates the Continue button below (and, transitively,
  // StepperRail's own visited[i]-only navigation - a step can never become
  // "visited" without going through here first, so there's no separate
  // bypass to close there). JobDetails/Review/Submit have nothing to
  // validate - Review is read-only, and Submit has no Continue button at
  // all (see the footer render below).
  const stepErrors = (key) => {
    switch (key) {
      case 'profile': {
        const missing = [];
        if (!profileDetailsForm.location) missing.push('Current location');
        if (!profileDetailsForm.nationalId) missing.push('National ID number');
        if (!profileDetailsForm.workAuthorization) missing.push('Work authorization');
        if (!(profile?.education?.length)) missing.push('At least one education entry');
        if (!(profile?.workExperience?.length)) missing.push('At least one work experience entry');
        return missing;
      }
      case 'referees': {
        const missing = [];
        refereesForm.forEach((r, i) => {
          if (!r.name || !r.phone || !r.email) missing.push(`Referee ${i + 1} (name, phone, email)`);
        });
        // Same person listed twice adds no real value as a second,
        // independent reference - compared by email/phone (trimmed,
        // case-insensitive) rather than name, since two different people
        // can share a name but never a phone or email.
        const flagged = new Set();
        for (let i = 0; i < refereesForm.length; i++) {
          for (let j = i + 1; j < refereesForm.length; j++) {
            const a = refereesForm[i], b = refereesForm[j];
            const sameEmail = a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
            const samePhone = a.phone && b.phone && a.phone.trim() === b.phone.trim();
            if ((sameEmail || samePhone) && !flagged.has(j)) {
              missing.push(`Referee ${j + 1} looks like the same person as Referee ${i + 1} - please provide three different referees`);
              flagged.add(j);
            }
          }
        }
        return missing;
      }
      case 'questions': {
        const missing = [];
        if (!questionsForm.openToRelocate) missing.push('Open to relocating?');
        if (!questionsForm.whyThisRole?.trim()) missing.push('Why this role?');
        (vacancy.desirableRequirements || []).forEach((r) => {
          if (desirableAnswers[r.id] === undefined) missing.push(r.text);
        });
        (vacancy.disqualifyingRequirements || []).forEach((r) => {
          if (disqualifyingAnswers[r.id] === undefined) missing.push(r.text);
        });
        return missing;
      }
      case 'internal': {
        const missing = [];
        if (!internalProfileForm.employeeId) missing.push('Employee ID');
        if (!internalProfileForm.dateJoined) missing.push('Date joined UCAA');
        if (!internalProfileForm.department) missing.push('Current department');
        if (!internalProfileForm.position) missing.push('Current position');
        if (!internalProfileForm.supervisorName) missing.push("Supervisor's name");
        if (!internalProfileForm.supervisorEmail) missing.push("Supervisor's email");
        return missing;
      }
      default:
        return [];
    }
  };
  const currentStepErrors = stepErrors(steps[stepIndex].key);

  // Application-level - CV/cover letter plus the Questions step answers,
  // all persisted through the same draft-save endpoint so "Save as draft"
  // captures everything entered so far in one request.
  const saveDraft = async () => {
    setMessage(''); setError(''); setSaving(true);
    try {
      const formData = new FormData();
      formData.append('vacancyId', vacancyId);
      if (coverLetter) formData.append('coverLetter', coverLetter);
      formData.append('desiredSalary', questionsForm.desiredSalary);
      formData.append('openToRelocate', questionsForm.openToRelocate);
      formData.append('earliestStartDate', questionsForm.earliestStartDate);
      formData.append('whyThisRole', questionsForm.whyThisRole);
      formData.append('desirableResponses', JSON.stringify(
        Object.entries(desirableAnswers)
          .filter(([, answer]) => typeof answer === 'boolean' || (typeof answer === 'number' && Number.isFinite(answer)))
          .map(([id, answer]) => ({ id, answer }))
      ));
      formData.append('disqualifyingResponses', JSON.stringify(
        Object.entries(disqualifyingAnswers)
          .filter(([, answer]) => typeof answer === 'boolean' || (typeof answer === 'number' && Number.isFinite(answer)))
          .map(([id, answer]) => ({ id, answer }))
      ));
      formData.append('referees', JSON.stringify(refereesForm));
      const res = await client.post('/api/applications', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setApplication(res.data);
      setMessage('Draft saved.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save draft');
    } finally {
      setSaving(false);
    }
  };

  // Candidate-level - National ID, location, work authorization, LinkedIn
  // and portfolio links. Saved separately from saveDraft since these live
  // on Candidate, not Application, and persist across every application.
  const saveProfileDetails = async () => {
    try {
      await client.put('/api/candidates/me', profileDetailsForm);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save profile details');
    }
  };

  const saveInternalProfile = async () => {
    try {
      await client.put('/api/candidates/me/internal-profile', internalProfileForm);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save internal profile');
    }
  };

  // Persists everything currently entered, regardless of which step is
  // active - Continue, the "Save as draft" button, and "Save & exit" all
  // call this instead of each needing its own step-aware subset of what to
  // save. That step-aware approach used to mean a field only covered by one
  // of these (e.g. Documents' portfolioUrl, only ever sent by
  // saveProfileDetails) could go unsaved if the candidate used a different
  // button than the logic anticipated. All three calls are cheap, idempotent
  // PUTs/an upsert-style POST, so saving all of them on every click is safe.
  const persistAll = async () => {
    await saveProfileDetails();
    if (candidate?.candidateType === 'Internal') await saveInternalProfile();
    if (!['Submitted', 'UnderReview'].includes(application?.status)) await saveDraft();
    setDirty(false);
  };

  const saveAndExit = async () => {
    setExiting(true);
    try {
      await persistAll();
    } finally {
      setExiting(false);
    }
    navigate(application ? '/dashboard/applications' : '/dashboard/jobs');
  };

  if (!vacancy || !applicationsChecked) {
    return (
      <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
        <div className="p-4 md:p-8">
          <div className="max-w-3xl mx-auto">
            <WizardExitHeader candidate={candidate} />
            <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
              <LoadingState label="Loading this vacancy..." />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // CHANGED - a Draft is now also blocked here, not just "no application at
  // all". A vacancy past its deadline can no longer be applied to OR
  // continued - the Draft row itself isn't touched by this (it stays
  // visible, with its Started date, on My Applications - see
  // CandidateApplications.jsx), it just can't be edited/submitted further,
  // matching applicationDraftController.saveDraft's own unconditional
  // assertBeforeDeadline. An already-Submitted-or-beyond application is
  // unaffected either way - it was decided before or after the deadline
  // stopped mattering to it.
  const deadlinePassed = vacancy.deadline && new Date(vacancy.deadline) < new Date();
  const blockedByDeadline = deadlinePassed && (!application || application.status === 'Draft');
  if (blockedByDeadline) {
    return (
      <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
        <div className="p-4 md:p-8">
          <div className="max-w-3xl mx-auto">
          <WizardExitHeader candidate={candidate} />
          <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 32, textAlign: 'center' }}>
            <h2 style={{ color: 'var(--color-primary-dark)', marginTop: 0 }}>Applications closed</h2>
            <p style={{ color: 'var(--color-text-muted)', maxWidth: 480, margin: '0 auto 20px' }}>
              The application deadline for <strong>{vacancy.title}</strong> ({vacancy.jobRef}) was{' '}
              {new Date(vacancy.deadline).toLocaleDateString()}. This vacancy is no longer accepting new applications.
              {application && ' Your draft is still saved and visible from My Applications, but can no longer be edited or submitted.'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/dashboard/jobs" style={{ textDecoration: 'none' }}>
                <Button>Browse open positions</Button>
              </Link>
              {application && (
                <Link to="/dashboard/applications" style={{ textDecoration: 'none' }}>
                  <Button variant="ghost">View my applications</Button>
                </Link>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  }

  const alreadyDecided = ['Submitted', 'UnderReview'].includes(application?.status);

  return (
    <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
      {showProfileModal && (
        <Modal title="Complete your profile" onClose={() => setShowProfileModal(false)} maxWidth={720}>
          <ProfileCompletionForm onComplete={() => setShowProfileModal(false)} />
        </Modal>
      )}
      <div className="p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
        <WizardExitHeader candidate={candidate} onSaveExit={saveAndExit} saving={exiting} />
        <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div className="flex flex-col md:flex-row">
            <StepperRail steps={steps} stepIndex={stepIndex} isComplete={isComplete} visited={visited} goTo={goTo} />

            {/* min-w-0 overrides flex's default min-width:auto - without it, an
                unbreakable long string anywhere inside (e.g. a long cover letter
                filename with no spaces) sets this column's minimum content size
                to the string's full width, forcing the whole wizard layout wider
                and getting hard-clipped by the card's overflow:hidden above, no
                matter what truncation styling exists further down the tree. */}
            <div className="flex-1 min-w-0 px-6 md:px-8 py-6 md:py-8">
              {steps[stepIndex].key === 'jobDetails' && <JobDetailsStep vacancy={vacancy} />}
              {steps[stepIndex].key === 'profile' && (
                <ProfileStep profile={profile} onProfileChange={loadProfile}
                  profileDetails={profileDetailsForm}
                  setProfileDetail={(key) => (e) => { setDirty(true); setProfileDetailsForm({ ...profileDetailsForm, [key]: e.target.value }); }} />
              )}
              {steps[stepIndex].key === 'documents' && (
                <DocumentsStep coverLetter={coverLetter} setCoverLetter={(file) => { setDirty(true); setCoverLetter(file); }}
                  portfolioUrl={profileDetailsForm.portfolioUrl}
                  setPortfolioUrl={(e) => { setDirty(true); setProfileDetailsForm({ ...profileDetailsForm, portfolioUrl: e.target.value }); }} />
              )}
              {steps[stepIndex].key === 'referees' && (
                <RefereesStep referees={refereesForm}
                  setReferee={(i, key) => (e) => { setDirty(true); setRefereesForm(refereesForm.map((r, idx) => idx === i ? { ...r, [key]: e.target.value } : r)); }} />
              )}
              {steps[stepIndex].key === 'questions' && (
                <QuestionsStep questions={questionsForm}
                  vacancyLocation={vacancy.location}
                  set={(key) => (e) => { setDirty(true); setQuestionsForm({ ...questionsForm, [key]: e.target.value }); }}
                  desirableRequirements={vacancy.desirableRequirements}
                  desirableAnswers={desirableAnswers}
                  setDesirableAnswer={(id) => (e) => { setDirty(true); setDesirableAnswers({ ...desirableAnswers, [id]: parseRequirementAnswer(vacancy.desirableRequirements, id, e.target.value) }); }}
                  disqualifyingRequirements={vacancy.disqualifyingRequirements}
                  disqualifyingAnswers={disqualifyingAnswers}
                  setDisqualifyingAnswer={(id) => (e) => { setDirty(true); setDisqualifyingAnswers({ ...disqualifyingAnswers, [id]: parseRequirementAnswer(vacancy.disqualifyingRequirements, id, e.target.value) }); }} />
              )}
              {steps[stepIndex].key === 'internal' && (
                <InternalProfileStep internalProfile={internalProfileForm}
                  set={(key) => (e) => { setDirty(true); setInternalProfileForm({ ...internalProfileForm, [key]: e.target.value }); }} />
              )}
              {steps[stepIndex].key === 'review' && (
                <ReviewStep profile={profile} coverLetter={coverLetter} referees={refereesForm} vacancy={vacancy}
                  profileDetails={profileDetailsForm} questions={questionsForm} internalProfile={internalProfileForm}
                  candidateType={candidate?.candidateType} goTo={goTo} stepIndexes={stepIndexes}
                  desirableRequirements={vacancy.desirableRequirements} desirableAnswers={desirableAnswers}
                  disqualifyingRequirements={vacancy.disqualifyingRequirements} disqualifyingAnswers={disqualifyingAnswers} />
              )}
              {steps[stepIndex].key === 'submit' && (
                <SubmitStep vacancy={vacancy} applicationId={application?.id} status={application?.status}
                  onSubmitted={() => setApplication({ ...application, status: 'Submitted' })}
                  onWithdrawn={() => navigate('/dashboard/applications')} />
              )}

              <Alert type="success" message={message} />
              <Alert type="error" message={error} />

              {/* Told plainly, not just implied by a disabled button - a
                  disabled Continue with no explanation reads as broken,
                  not gated. Only ever shown for the step actually being
                  viewed, so it disappears the moment its own fields are
                  filled in without needing to click Continue first. */}
              {currentStepErrors.length > 0 && (
                <p style={{ fontSize: 13, color: 'var(--color-danger)', marginTop: 16 }}>
                  Before continuing, please complete: {currentStepErrors.join(', ')}
                </p>
              )}

              {/* Back/Save/Continue stay visible while viewing the Submit
                  step pre-submission - only hidden once the application has
                  actually been decided (Submitted/UnderReview), so a
                  candidate can still go back and fix something right up
                  until they hit "Send application". */}
              {!(steps[stepIndex].key === 'submit' && alreadyDecided) && (
                <div className="flex justify-between mt-8 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <button onClick={back} disabled={stepIndex === 0} className="flex items-center gap-1"
                    style={{ fontSize: 13, color: stepIndex === 0 ? 'var(--color-border)' : 'var(--color-text-muted)', background: 'none', border: 'none', cursor: stepIndex === 0 ? 'default' : 'pointer' }}>
                    <ChevronLeft size={15} /> Back
                  </button>
                  {steps[stepIndex].key !== 'submit' && (
                    <div style={{ display: 'flex', gap: 12 }}>
                      {!alreadyDecided && steps[stepIndex].key !== 'jobDetails' && (
                        <Button type="button" variant="ghost" onClick={async () => { setSaving(true); try { await persistAll(); } finally { setSaving(false); } }} disabled={saving}>
                          {saving ? 'Saving...' : 'Save as draft'}
                        </Button>
                      )}
                      <Button type="button" disabled={continuing || currentStepErrors.length > 0} onClick={async () => {
                        setContinuing(true);
                        try {
                          // persistAll guarantees an Application draft row
                          // exists (with whatever cover letter/referees/
                          // answers have been entered so far) by the time the
                          // candidate can reach Review/Submit - without this,
                          // a candidate who never clicks the separate "Save
                          // as draft" button reaches Submit with
                          // applicationId still null, and Send application
                          // calls PATCH /api/applications/undefined/submit.
                          await persistAll();
                          next();
                        } finally {
                          setContinuing(false);
                        }
                      }}>
                        {/* persistAll now always saves everything (profile
                            details + internal profile + the draft) instead
                            of a step-specific subset, so this click can take
                            a couple of sequential round-trips - worth its
                            own "Continuing..." label rather than just a
                            disabled button with no explanation, same as
                            "Save as draft" already does. */}
                        {continuing ? 'Continuing...' : <>Continue <ChevronRight size={15} /></>}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
