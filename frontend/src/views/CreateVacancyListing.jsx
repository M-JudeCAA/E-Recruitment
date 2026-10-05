import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, CalendarClock, FileText, FileCheck2, UserCheck } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import TextField from '../components/TextField';
import TextArea from '../components/TextArea';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Modal from '../components/Modal';
import VacancyAdvertFields from '../components/VacancyAdvertFields';
import VacancyAdvert from '../components/VacancyAdvert';
import RequisitionPanel from '../components/RequisitionPanel';
import HiringManagerPicker from '../components/HiringManagerPicker';
import useVacancyDraft from '../models/useVacancyDraft';

const emptyForm = {
  departmentId: '', positionId: '', reportsToPositionId: '', hiringManager: null,
  positionsRequired: 1, postingType: '', deadline: '', // postingType is now required with no default, so this starts blank to force an explicit choice
  salaryScale: '',
  // Site/contract metadata, distinct from the org-structure fields above -
  // location is shown to candidates (JobDetailsStep.jsx); internalSalaryRange
  // and recruiterNotes are HR-only and never sent to the candidate-facing API.
  location: '', employmentCategory: '', internalSalaryRange: '', recruiterNotes: '',
  // Structured advert content (Job Purpose / Person Specification) - see
  // backend/prisma/schema.prisma's comment on Vacancy.jobPurpose.
  minimumExperienceYears: '', minimumEducationLevel: '', preferredFieldOfStudy: '',
  // Real, machine-checked criteria against structured candidate data
  // (age, flying hours, O-Level/A-Level subject grades) - see
  // Vacancy.minimumAge/maximumAge/minimumFlyingHours/requiredExamGrades.
  minimumAge: '', maximumAge: '', minimumFlyingHours: '', minimumCGPA: '', requiredExamGrades: [],
  jobPurpose: '', essentialRequirements: [],
  desirableRequirements: [], disqualifyingRequirements: [], generalKnowledge: [], specialSkills: [],
  desirableQualifications: []
};

const EMPLOYMENT_CATEGORY_LABELS = { FullTime: 'Full-time', Contract: 'Contract', FixedTermContract: 'Fixed Term Contract' };
// UCAA's actual sites - matches backend/src/utils/vacancyValidation.js's
// VALID_LOCATIONS exactly (confirmed against a real reference "Create
// Job" form).
const LOCATIONS = [
  'Entebbe International Airport', 'UCAA Head Office — Entebbe', 'Kampala HQ',
  'Gulu Aerodrome', 'Jinja Aerodrome', 'Mbarara Aerodrome', 'Fort Portal (Kasese) Aerodrome',
  'Arua Aerodrome', 'Soroti Aerodrome', 'Kidepo Aerodrome'
];

// Two columns on a wide screen, one on narrow - short fields (a number, a
// date, a one-word select) don't need a full row to themselves the way a
// long one does; that mismatch was most of what made this form feel long.
const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 20px' };

// A labeled section header shared by every card below - an icon in a
// tinted circle plus a title and one-line description, so each block of
// the form reads as its own clear, scannable unit at a glance rather than
// the reader having to infer where one group of fields ends and the next
// begins from spacing alone.
function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
      <span style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 40, height: 40, borderRadius: '50%',
        background: 'var(--color-primary-light)', color: 'var(--color-primary-dark)'
      }}>
        <Icon size={19} />
      </span>
      <div>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{description}</p>
      </div>
    </div>
  );
}

// Its own page rather than a modal over the vacancy list - a form this
// long deserves the full viewport and a real URL/back button, not a
// scrollable dialog. Organized as clearly separated, icon-labeled sections
// on one page (not a multi-step wizard - forcing every field behind
// several button clicks turned out to feel like more work, not less) so
// HR can see the whole shape of what they're filling in and jump straight
// to any part of it. HRDashboard.jsx still owns the vacancy list and the
// (much shorter) edit modal, left as a modal since it only exposes the
// small post-creation-editable subset of fields.
export default function CreateVacancyListing() {
  const navigate = useNavigate();
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  const [departmentPositions, setDepartmentPositions] = useState([]);
  const [reportsToOptions, setReportsToOptions] = useState([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [loadingReportsTo, setLoadingReportsTo] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // Separate from form.location itself - lets "Other" stay selected (and
  // its text input visible) while the candidate types, even though the
  // in-progress value isn't one of LOCATIONS and may briefly be empty.
  const [customLocation, setCustomLocation] = useState(false);
  const [creating, setCreating] = useState(false); // double-submission lock
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  // The EXCO-approved requisition this vacancy is created from - nothing
  // below it is shown until one has been read (see RequisitionPanel).
  const [requisition, setRequisition] = useState(null);
  const [requisitionConfirmed, setRequisitionConfirmed] = useState(false);
  // The scan of the requisition as EXCO signed it - uploaded alongside the
  // readable document, and required to create the vacancy.
  const [signedCopy, setSignedCopy] = useState(null);

  // Drafts: the form (and what was read from the requisition) is saved as
  // HR works - automatically, or with "Save draft" - and reopened from the
  // vacancy list via ?draft=<id>. The EXCO confirmation is never saved; it
  // is given fresh each time the vacancy is created.
  const [searchParams, setSearchParams] = useSearchParams();
  const openedDraftId = useRef(searchParams.get('draft'));
  const [loadingDraft, setLoadingDraft] = useState(!!openedDraftId.current);
  const [creatingPause, setCreatingPause] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const onDraftCreated = useCallback((id) => setSearchParams({ draft: String(id) }, { replace: true }), [setSearchParams]);
  const draft = useVacancyDraft({
    values: { form, requisition, signedCopy },
    enabled: !!requisition && !loadingDraft && !creatingPause,
    onCreated: onDraftCreated
  });

  useEffect(() => {
    staffClient.get('/api/departments/approved')
      .then((res) => setApprovedDepartments(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load departments'));
  }, []);

  function groupDepartmentsByDirectorate(departments) {
    const groups = {};
    departments.forEach((dept) => {
      const key = dept.directorate.name;
      if (!groups[key]) groups[key] = [];
      groups[key].push(dept);
    });
    return groups;
  }

  // Step 1: Department chosen first - loads a short, scoped Position list.
  const handleDepartmentChange = async (departmentId) => {
    setForm({ ...form, departmentId, positionId: '', reportsToPositionId: '' });
    setReportsToOptions([]);
    if (!departmentId) { setDepartmentPositions([]); return; }
    setLoadingPositions(true);
    try {
      const res = await staffClient.get(`/api/departments/${departmentId}/positions`);
      setDepartmentPositions(res.data);
    } finally {
      setLoadingPositions(false);
    }
  };

  // Step 2: Position (Title) chosen - loads senior positions for Reports To.
  const handlePositionChange = async (positionId) => {
    setForm({ ...form, positionId, reportsToPositionId: '' });
    if (!positionId) { setReportsToOptions([]); return; }
    setLoadingReportsTo(true);
    try {
      const res = await staffClient.get(`/api/positions/${positionId}/senior-options`);
      setReportsToOptions(res.data);
    } finally {
      setLoadingReportsTo(false);
    }
  };

  // The position and reports-to lists a department/position choice needs.
  const loadOrganogramLists = async (departmentId, positionId) => {
    setDepartmentPositions(departmentId ? (await staffClient.get(`/api/departments/${departmentId}/positions`)).data : []);
    setReportsToOptions(positionId ? (await staffClient.get(`/api/positions/${positionId}/senior-options`)).data : []);
  };

  // Reopening a saved draft.
  useEffect(() => {
    const id = openedDraftId.current;
    if (!id) return;
    (async () => {
      try {
        const { data } = await staffClient.get(`/api/vacancy-drafts/${id}`);
        const loadedForm = { ...emptyForm, ...data.form };
        await loadOrganogramLists(loadedForm.departmentId, loadedForm.positionId).catch(() => {});
        setCustomLocation(!!(loadedForm.location && !LOCATIONS.includes(loadedForm.location)));
        setRequisition(data.requisition || null);
        setSignedCopy(data.signedCopy || null);
        setForm(loadedForm);
        draft.markLoaded(data, { form: loadedForm, requisition: data.requisition || null, signedCopy: data.signedCopy || null });
      } catch (err) {
        setError(err.response?.status === 404 ? 'That draft no longer exists - it may have been used to create a vacancy, or deleted.' : (err.response?.data?.error || 'Could not open the draft'));
        setSearchParams({}, { replace: true });
      } finally {
        setLoadingDraft(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDraftNow = async () => {
    setDraftMessage('');
    if (await draft.saveNow()) setDraftMessage('Draft saved. You can finish it later from Vacancies.');
  };

  // Fills the form from what was read off the requisition, loading the
  // position and reports-to lists the matched organogram entries need.
  const applyRequisition = async (result) => {
    setRequisition(result);
    setRequisitionConfirmed(false);
    setError('');
    const p = result.prefill || {};
    const next = { ...emptyForm };
    for (const [key, value] of Object.entries(p)) next[key] = Array.isArray(value) ? value : String(value);
    if (p.positionsRequired) next.positionsRequired = Number(p.positionsRequired);
    setCustomLocation(!!(p.location && !LOCATIONS.includes(p.location)));
    try {
      await loadOrganogramLists(p.departmentId, p.positionId);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load the positions for the matched department');
    }
    setForm(next);
  };

  // A different requisition needs its own signed scan.
  const replaceRequisition = () => {
    setRequisition(null);
    setSignedCopy(null);
    setRequisitionConfirmed(false);
  };

  // Resolves the currently-selected department/position/reports-to ids
  // into display names for the preview - the form only holds ids, so this
  // is the one place that needs the lookup lists already loaded for the
  // cascading selects above.
  const previewForm = () => {
    const dept = approvedDepartments.find((d) => String(d.id) === String(form.departmentId));
    const position = departmentPositions.find((p) => String(p.id) === String(form.positionId));
    const reportsTo = reportsToOptions.find((p) => String(p.id) === String(form.reportsToPositionId));
    setPreviewData({
      jobRef: null,
      title: position?.name || '(select a title)',
      departmentLabel: dept ? `${dept.name}${dept.directorate?.name ? ', ' + dept.directorate.name : ''}` : null,
      reportsToName: reportsTo?.name,
      salaryScale: form.salaryScale, positionsRequired: form.positionsRequired, deadline: form.deadline,
      location: form.location, employmentCategory: form.employmentCategory,
      jobPurpose: form.jobPurpose, essentialRequirements: form.essentialRequirements,
      minimumEducationLevel: form.minimumEducationLevel, minimumExperienceYears: form.minimumExperienceYears,
      preferredFieldOfStudy: form.preferredFieldOfStudy,
      minimumAge: form.minimumAge, maximumAge: form.maximumAge,
      minimumFlyingHours: form.minimumFlyingHours, minimumCGPA: form.minimumCGPA, requiredExamGrades: form.requiredExamGrades,
      desirableRequirements: form.desirableRequirements,
      generalKnowledge: form.generalKnowledge, specialSkills: form.specialSkills, desirableQualifications: form.desirableQualifications
    });
  };

  const createVacancy = async (e) => {
    e.preventDefault();
    if (creating) return; // a double-click or slow-network retry must not create two vacancies
    if (!requisition) { setError('Upload the EXCO-approved requisition first.'); return; }
    if (!signedCopy) { setError('Upload the scan of the requisition as EXCO signed it.'); return; }
    if (!requisitionConfirmed) { setError('Confirm that the requisition has been approved and signed by EXCO.'); return; }
    // Not on the requisition, so HR always sets it here.
    if (!form.deadline) { setError('Set the application deadline (under Listing details).'); return; }
    setError(''); setCreating(true);
    // No auto-save may land after the vacancy (and so the draft) is done.
    draft.cancelPending();
    setCreatingPause(true);
    try {
      const res = await staffClient.post('/api/vacancies', {
        ...form, requisitionDocument: requisition.document, requisitionSignedCopy: signedCopy, requisitionConfirmed: true,
        ...(draft.draftId ? { draftId: draft.draftId } : {})
      });
      navigate('/hr', { state: { vacancyCreatedMessage: `Vacancy created (Ref: ${res.data.jobRef}). It needs Manager or Director approval to open.` } });
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Failed to create vacancy'));
      setCreating(false);
      setCreatingPause(false);
    }
  };

  const draftStatusText = {
    unsaved: 'Unsaved changes',
    saving: 'Saving draft...',
    saved: draft.savedAt ? `Draft saved ${draft.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Draft saved',
    error: 'Draft not saved - it will try again when you next make a change',
    conflict: 'Not saved - this draft was saved from another window. Reload it (link at the top) to continue.'
  }[draft.status];

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="vacancies" />

        <div style={{ flex: 1, minWidth: 0 }}>
      <PageHeader title="New Listing" subtitle="Create a vacancy from an EXCO-approved requisition" />
      <p style={{ marginTop: -12, marginBottom: 'var(--spacing-md)' }}>
        <Link to="/hr">&larr; Back to vacancies</Link>
      </p>

      <Alert type="error" message={error} />
      <Alert type="success" message={draftMessage} />
      {draft.status === 'conflict' && (
        <Alert type="warning" message={<>
          {draft.error}{' '}
          <a href={`/hr/vacancies/new?draft=${draft.draftId}`}>Reload the draft</a>
        </>} />
      )}

      <form onSubmit={createVacancy} style={{ maxWidth: 820 }}>
        <Card style={{ padding: 'var(--spacing-lg)' }}>
          <SectionHeader icon={FileCheck2} title="Approved requisition"
            description="The job details come from the requisition EXCO approved and signed." />
          {loadingDraft
            ? <p style={{ fontSize: 14, color: 'var(--color-text-muted)', margin: 0 }}>Opening your draft...</p>
            : <RequisitionPanel requisition={requisition} onRead={applyRequisition} onReplace={replaceRequisition}
                signedCopy={signedCopy} onSignedCopyChange={setSignedCopy}
                confirmed={requisitionConfirmed} onConfirmChange={setRequisitionConfirmed}
                jdExceptionReason={form.jdExceptionReason}
                onJdExceptionReasonChange={(jdExceptionReason) => setForm((prev) => ({ ...prev, jdExceptionReason }))} />}
        </Card>

        {requisition && (<>
        <Card style={{ padding: 'var(--spacing-lg)' }}>
          <SectionHeader icon={Building2} title="Position"
            description="Where this role sits in the organization, and how many openings it has." />

          {/* Department first, grouped by Directorate - true single-level
              grouping, since each Department row belongs to exactly one
              Directorate. Disambiguates cases like "CWG", which exists
              under five different directorates at UCAA. */}
          <Select label="Department" required value={form.departmentId} onChange={(e) => handleDepartmentChange(e.target.value)}>
            <option value="">Select a department</option>
            {Object.entries(groupDepartmentsByDirectorate(approvedDepartments)).map(([directorateName, depts]) => (
              <optgroup key={directorateName} label={directorateName}>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </optgroup>
            ))}
          </Select>

          <div style={fieldGrid}>
            <div>
              <Select label="Title" required value={form.positionId} onChange={(e) => handlePositionChange(e.target.value)} disabled={!form.departmentId || loadingPositions}>
                <option value="">{loadingPositions ? 'Loading positions...' : form.departmentId ? 'Select a position' : 'Select a department first'}</option>
                {departmentPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {form.departmentId && !loadingPositions && departmentPositions.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -14 }}>
                  No positions yet. <Link to="/hr/departments">Add one</Link>.
                </p>
              )}
            </div>
            <div>
              <Select label="Reports to" value={form.reportsToPositionId}
                onChange={(e) => setForm({ ...form, reportsToPositionId: e.target.value })} disabled={!form.positionId || loadingReportsTo}>
                <option value="">{loadingReportsTo ? 'Loading...' : form.positionId ? 'Select a position (optional)' : 'Select a title first'}</option>
                {reportsToOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {form.positionId && !loadingReportsTo && reportsToOptions.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -14 }}>
                  No senior position exists yet in this department.
                </p>
              )}
            </div>
          </div>

          <div style={fieldGrid}>
            <TextField label="Positions required" type="number" min="1" value={form.positionsRequired}
              onChange={(e) => setForm({ ...form, positionsRequired: Number(e.target.value) })} />
            <Select label="Posting type" required value={form.postingType} onChange={(e) => setForm({ ...form, postingType: e.target.value })}>
              <option value="">Select one</option>
              <option value="Internal">Internal only</option>
              <option value="External">External only</option>
            </Select>
          </div>
        </Card>

        <Card style={{ padding: 'var(--spacing-lg)' }}>
          <SectionHeader icon={UserCheck} title="Hiring manager"
            description="Who this vacancy is being filled for - a UCAA employee. They get email updates as the recruitment moves on, and need no access to this system." />
          <HiringManagerPicker value={form.hiringManager} onChange={(hiringManager) => setForm((prev) => ({ ...prev, hiringManager }))} />
        </Card>

        <Card style={{ padding: 'var(--spacing-lg)' }}>
          <SectionHeader icon={CalendarClock} title="Listing details"
            description="Timeline and compensation. The internal salary range and recruiter notes are never shown to candidates." />

          <div style={fieldGrid}>
            <TextField label="Deadline" type="date" required value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            <div>
              <Select label="Location" value={customLocation ? '__custom__' : form.location}
                onChange={(e) => {
                  if (e.target.value === '__custom__') { setCustomLocation(true); }
                  else { setCustomLocation(false); setForm({ ...form, location: e.target.value }); }
                }}>
                <option value="">Not specified</option>
                {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                <option value="__custom__">Other (specify)</option>
              </Select>
              {customLocation && (
                <TextField label="Custom location" placeholder="e.g. a new site not listed above"
                  value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              )}
            </div>
          </div>
          <div style={fieldGrid}>
            <Select label="Employment category" value={form.employmentCategory}
              onChange={(e) => setForm({ ...form, employmentCategory: e.target.value })}>
              <option value="">Not specified</option>
              {Object.entries(EMPLOYMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <TextField label="Salary level / scale" placeholder="e.g. Scale 5" value={form.salaryScale}
              onChange={(e) => setForm({ ...form, salaryScale: e.target.value })} />
          </div>
          <TextField label="Internal salary range (HR only - never shown to candidates)" placeholder="e.g. UGX 3.2M–5.8M"
            value={form.internalSalaryRange} onChange={(e) => setForm({ ...form, internalSalaryRange: e.target.value })} />
          <TextArea label="Notes for recruiters (HR only)" rows={2} placeholder="Optional guidance for whoever reviews the shortlist"
            value={form.recruiterNotes} onChange={(e) => setForm({ ...form, recruiterNotes: e.target.value })} />
        </Card>

        <Card style={{ padding: 'var(--spacing-lg)' }}>
          <SectionHeader icon={FileText} title="Job purpose & requirements"
            description="Read from the requisition - check it. Screening criteria and questions aren't on the requisition: add them here." />
          <VacancyAdvertFields values={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />
        </Card>

        {/* Actions live in their own visually distinct bar at the bottom,
            not just another row inside the last card - a form this length
            benefits from a clear, deliberate "you're done, here's what
            happens next" moment rather than the buttons blending into
            whatever section happened to be last. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          padding: 'var(--spacing-md) var(--spacing-lg)', marginTop: 'var(--spacing-md)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Button type="button" variant="ghost" onClick={() => navigate('/hr')}>{draft.draftId ? 'Close' : 'Cancel'}</Button>
            {draftStatusText && (
              <span role="status" style={{ fontSize: 13, color: ['error', 'conflict'].includes(draft.status) ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                {draftStatusText}
              </span>
            )}
          </div>
          {/* The same error as the alert at the top, which is a long scroll
              away from this button. */}
          {error && (
            <div role="alert" style={{ flexBasis: '100%', order: -1, fontSize: 13, color: 'var(--color-danger)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button type="button" variant="ghost" onClick={saveDraftNow}
              disabled={draft.status === 'saving' || draft.status === 'conflict'}>Save draft</Button>
            <Button type="button" variant="secondary" onClick={previewForm}>Preview advert</Button>
            <Button type="submit" disabled={creating || !requisitionConfirmed || !signedCopy}
              title={!signedCopy ? 'Upload the signed copy of the requisition above first'
                : requisitionConfirmed ? undefined : 'Confirm the EXCO approval above first'}>
              {creating ? 'Creating...' : 'Create listing'}
            </Button>
          </div>
        </div>
        </>)}
      </form>

      {previewData && (
        <Modal title="Vacancy advert preview" onClose={() => setPreviewData(null)} maxWidth={720}
          footer={<Button variant="ghost" onClick={() => setPreviewData(null)}>Close</Button>}>
          <VacancyAdvert {...previewData} />
        </Modal>
      )}
        </div>
      </div>
    </div>
  );
}
