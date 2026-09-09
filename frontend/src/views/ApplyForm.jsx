import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingState from '../components/LoadingState';
import StepperRail from './apply-wizard/StepperRail';
import JobDetailsStep from './apply-wizard/JobDetailsStep';
import ProfileStep from './apply-wizard/ProfileStep';
import DocumentsStep from './apply-wizard/DocumentsStep';
import QuestionsStep from './apply-wizard/QuestionsStep';
import InternalProfileStep from './apply-wizard/InternalProfileStep';
import ReviewStep from './apply-wizard/ReviewStep';
import SubmitStep from './apply-wizard/SubmitStep';

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
    nationalId: '', location: '', workAuthorization: '', linkedinUrl: '', portfolioUrl: ''
  });
  const [internalProfileForm, setInternalProfileForm] = useState({});
  // Application-level fields (vary per application) - the Questions step.
  const [questionsForm, setQuestionsForm] = useState({
    desiredSalary: '', openToRelocate: '', earliestStartDate: '', whyThisRole: ''
  });
  // Answers to the vacancy's Desirable Requirements Yes/No questions -
  // kept as { [requirementId]: true | false }, one key per question the
  // candidate has actually answered so far. Converted to the [{id,
  // answer}] array the backend expects only at save time (see saveDraft).
  const [desirableAnswers, setDesirableAnswers] = useState({});
  const [cv, setCv] = useState(null);
  const [coverLetter, setCoverLetter] = useState(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [visited, setVisited] = useState({ 0: true });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfile = () => client.get('/api/candidates/me').then((res) => {
    setProfile(res.data);
    setProfileDetailsForm({
      nationalId: res.data.nationalId || '',
      location: res.data.location || '',
      workAuthorization: res.data.workAuthorization || '',
      linkedinUrl: res.data.linkedinUrl || '',
      portfolioUrl: res.data.portfolioUrl || ''
    });
    if (res.data.internalProfile) setInternalProfileForm(res.data.internalProfile);
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
      }
    });
  }, [vacancyId]);

  const steps = [
    { key: 'jobDetails', label: 'Job Details', note: 'About this role' },
    { key: 'profile', label: 'Profile', note: 'Who you are' },
    { key: 'documents', label: 'Documents', note: 'CV & links' },
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

  // Application-level - CV/cover letter plus the Questions step answers,
  // all persisted through the same draft-save endpoint so "Save as draft"
  // captures everything entered so far in one request.
  const saveDraft = async () => {
    setMessage(''); setError(''); setSaving(true);
    try {
      const formData = new FormData();
      formData.append('vacancyId', vacancyId);
      if (cv) formData.append('cv', cv);
      if (coverLetter) formData.append('coverLetter', coverLetter);
      formData.append('desiredSalary', questionsForm.desiredSalary);
      formData.append('openToRelocate', questionsForm.openToRelocate);
      formData.append('earliestStartDate', questionsForm.earliestStartDate);
      formData.append('whyThisRole', questionsForm.whyThisRole);
      formData.append('desirableResponses', JSON.stringify(
        Object.entries(desirableAnswers)
          .filter(([, answer]) => typeof answer === 'boolean')
          .map(([id, answer]) => ({ id, answer }))
      ));
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

  if (!vacancy) {
    return (
      <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
        <div className="p-4 md:p-8">
          <div className="max-w-3xl mx-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }}>
            <LoadingState label="Loading this vacancy..." />
          </div>
        </div>
      </div>
    );
  }

  const alreadyDecided = ['Submitted', 'UnderReview'].includes(application?.status);

  return (
    <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
      <div className="p-4 md:p-8">
        <div className="max-w-3xl mx-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div className="flex flex-col md:flex-row">
            <StepperRail steps={steps} stepIndex={stepIndex} isComplete={isComplete} visited={visited} goTo={goTo} />

            <div className="flex-1 px-6 md:px-8 py-6 md:py-8">
              {steps[stepIndex].key === 'jobDetails' && <JobDetailsStep vacancy={vacancy} />}
              {steps[stepIndex].key === 'profile' && (
                <ProfileStep profile={profile} onProfileChange={loadProfile}
                  profileDetails={profileDetailsForm}
                  setProfileDetail={(key) => (e) => setProfileDetailsForm({ ...profileDetailsForm, [key]: e.target.value })} />
              )}
              {steps[stepIndex].key === 'documents' && (
                <DocumentsStep cv={cv} coverLetter={coverLetter} setCv={setCv} setCoverLetter={setCoverLetter}
                  portfolioUrl={profileDetailsForm.portfolioUrl}
                  setPortfolioUrl={(e) => setProfileDetailsForm({ ...profileDetailsForm, portfolioUrl: e.target.value })} />
              )}
              {steps[stepIndex].key === 'questions' && (
                <QuestionsStep questions={questionsForm}
                  set={(key) => (e) => setQuestionsForm({ ...questionsForm, [key]: e.target.value })}
                  desirableRequirements={vacancy.desirableRequirements}
                  desirableAnswers={desirableAnswers}
                  setDesirableAnswer={(id) => (e) => setDesirableAnswers({ ...desirableAnswers, [id]: e.target.value === 'Yes' })} />
              )}
              {steps[stepIndex].key === 'internal' && (
                <InternalProfileStep internalProfile={internalProfileForm}
                  set={(key) => (e) => setInternalProfileForm({ ...internalProfileForm, [key]: e.target.value })} />
              )}
              {steps[stepIndex].key === 'review' && (
                <ReviewStep profile={profile} cv={cv} coverLetter={coverLetter}
                  profileDetails={profileDetailsForm} questions={questionsForm} internalProfile={internalProfileForm}
                  candidateType={candidate?.candidateType} goTo={goTo} stepIndexes={stepIndexes}
                  desirableRequirements={vacancy.desirableRequirements} desirableAnswers={desirableAnswers} />
              )}
              {steps[stepIndex].key === 'submit' && (
                <SubmitStep vacancy={vacancy} applicationId={application?.id} status={application?.status}
                  onSubmitted={() => setApplication({ ...application, status: 'Submitted' })}
                  onWithdrawn={() => navigate('/dashboard')} />
              )}

              <Alert type="success" message={message} />
              <Alert type="error" message={error} />

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
                        <Button type="button" variant="ghost" onClick={saveDraft} disabled={saving}>
                          {saving ? 'Saving...' : 'Save as draft'}
                        </Button>
                      )}
                      <Button type="button" onClick={() => {
                        if (steps[stepIndex].key === 'profile' || steps[stepIndex].key === 'documents') saveProfileDetails();
                        if (steps[stepIndex].key === 'internal') saveInternalProfile();
                        next();
                      }}>
                        Continue <ChevronRight size={15} />
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
  );
}
