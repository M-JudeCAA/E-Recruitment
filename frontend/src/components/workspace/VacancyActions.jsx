import React, { useState } from 'react';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Alert from '../Alert';
import Modal from '../Modal';
import TextField from '../TextField';
import TextArea from '../TextArea';
import Select from '../Select';
import ReasonDialog from '../ReasonDialog';
import VacancyAdvert from '../VacancyAdvert';
import VacancyAdvertFields from '../VacancyAdvertFields';
import { useConfirm } from '../ConfirmDialog';
import { approveVacancy } from '../../utils/approveVacancy';
import { MenuButton, rankOf, ROLE_RANK } from './ui';

// Every action on one vacancy, for the header of its workspace page:
// View advert, Edit, and a "⋯" menu (resubmit, return/reject for an
// approver, re-open, readvertise, change posting type, export, close), each
// with the dialog it needs. The rules match the API's: approving, returning,
// rejecting, re-opening and changing the posting type are Manager+;
// closing is Principal HR Officer+; a returned vacancy is resubmitted by HR.
// `primary` is the page's main button, placed last.

const EMPLOYMENT_CATEGORY_LABELS = { FullTime: 'Full-time', Contract: 'Contract', FixedTermContract: 'Fixed Term Contract' };
// Matches backend/src/utils/vacancyValidation.js's VALID_LOCATIONS.
const LOCATIONS = [
  'Entebbe International Airport', 'UCAA Head Office — Entebbe', 'Kampala HQ',
  'Gulu Aerodrome', 'Jinja Aerodrome', 'Mbarara Aerodrome', 'Fort Portal (Kasese) Aerodrome',
  'Arua Aerodrome', 'Soroti Aerodrome', 'Kidepo Aerodrome'
];
// Candidates can see (or have seen) the vacancy - moving its deadline then needs a reason.
const PUBLISHED_STATUSES = ['Open', 'PartiallyFilled', 'Filled', 'Closed'];

const vacancyToFormFields = (v) => ({
  positionsRequired: v.positionsRequired, postingType: v.postingType,
  deadline: v.deadline ? v.deadline.slice(0, 10) : '',
  salaryScale: v.salaryScale || '', location: v.location || '', employmentCategory: v.employmentCategory || '',
  internalSalaryRange: v.internalSalaryRange || '', recruiterNotes: v.recruiterNotes || '',
  minimumExperienceYears: v.minimumExperienceYears ?? '', minimumEducationLevel: v.minimumEducationLevel || '',
  preferredFieldOfStudy: v.preferredFieldOfStudy || '', minimumAge: v.minimumAge ?? '', maximumAge: v.maximumAge ?? '',
  minimumFlyingHours: v.minimumFlyingHours ?? '', minimumCGPA: v.minimumCGPA ?? '', requiredExamGrades: v.requiredExamGrades || [],
  jobPurpose: v.jobPurpose || '', essentialRequirements: v.essentialRequirements || [],
  desirableRequirements: v.desirableRequirements || [], disqualifyingRequirements: v.disqualifyingRequirements || [],
  generalKnowledge: v.generalKnowledge || [], specialSkills: v.specialSkills || [], desirableQualifications: v.desirableQualifications || []
});

const departmentLabel = (v) => (v.department?.name
  ? `${v.department.name}${v.department.directorate?.name ? `, ${v.department.directorate.name}` : ''}` : null);

const advertFrom = (v, form, extra = {}) => ({
  jobRef: v.jobRef, title: v.title, departmentLabel: departmentLabel(v), reportsToName: v.reportsToPosition?.name,
  salaryScale: form.salaryScale, positionsRequired: form.positionsRequired, deadline: form.deadline,
  location: form.location, employmentCategory: form.employmentCategory, jobPurpose: form.jobPurpose,
  essentialRequirements: form.essentialRequirements, minimumEducationLevel: form.minimumEducationLevel,
  minimumExperienceYears: form.minimumExperienceYears, preferredFieldOfStudy: form.preferredFieldOfStudy,
  minimumAge: form.minimumAge, maximumAge: form.maximumAge, minimumFlyingHours: form.minimumFlyingHours,
  minimumCGPA: form.minimumCGPA, requiredExamGrades: form.requiredExamGrades, desirableRequirements: form.desirableRequirements,
  generalKnowledge: form.generalKnowledge, specialSkills: form.specialSkills, desirableQualifications: form.desirableQualifications,
  ...extra
});

const errorText = (err, fallback) => {
  const errs = err.response?.data?.errors;
  return errs ? errs.join('; ') : (err.response?.data?.error || fallback);
};

/** The advert fields form shared by Edit and Readvertise. */
function VacancyForm({ vacancy, form, setForm, mode }) {
  const [customLocation, setCustomLocation] = useState(!!(form.location && !LOCATIONS.includes(form.location)));
  const deadlineMoved = mode === 'edit' && PUBLISHED_STATUSES.includes(vacancy.status)
    && form.deadline !== (vacancy.deadline ? vacancy.deadline.slice(0, 10) : '');
  return (
    <>
      <TextField label="Positions required" type="number" min="1" value={form.positionsRequired}
        onChange={(e) => setForm({ ...form, positionsRequired: Number(e.target.value) })} />
      {/* Posting type can only change here before approval; once a vacancy
          is live it changes through the audited "Change to ..." action. */}
      <Select label="Posting type" value={form.postingType} onChange={(e) => setForm({ ...form, postingType: e.target.value })} required>
        <option value="">Select one</option>
        <option value="Internal">Internal only</option>
        <option value="External">External only</option>
      </Select>
      <TextField label="Deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
      {deadlineMoved && (
        <TextField label="Reason for changing the deadline" required value={form.deadlineReason || ''}
          hint="Candidates can already see this vacancy, so the change and its reason are kept in the vacancy's history."
          onChange={(e) => setForm({ ...form, deadlineReason: e.target.value })} />
      )}
      <TextField label="Salary level / scale" value={form.salaryScale} onChange={(e) => setForm({ ...form, salaryScale: e.target.value })} />
      <Select label="Location" value={customLocation ? '__custom__' : form.location}
        onChange={(e) => {
          if (e.target.value === '__custom__') setCustomLocation(true);
          else { setCustomLocation(false); setForm({ ...form, location: e.target.value }); }
        }}>
        <option value="">Not specified</option>
        {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
        <option value="__custom__">Other (specify)</option>
      </Select>
      {customLocation && (
        <TextField label="Custom location" placeholder="e.g. a new site not listed above" value={form.location}
          onChange={(e) => setForm({ ...form, location: e.target.value })} />
      )}
      <Select label="Employment category" value={form.employmentCategory} onChange={(e) => setForm({ ...form, employmentCategory: e.target.value })}>
        <option value="">Not specified</option>
        {Object.entries(EMPLOYMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <TextField label="Internal salary range (HR only - never shown to candidates)" value={form.internalSalaryRange}
        onChange={(e) => setForm({ ...form, internalSalaryRange: e.target.value })} />
      <TextArea label="Notes for recruiters (HR only)" rows={2} value={form.recruiterNotes}
        onChange={(e) => setForm({ ...form, recruiterNotes: e.target.value })} />
      <VacancyAdvertFields values={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />
    </>
  );
}

export default function VacancyActions({ vacancy: v, staffRole, onChanged, primary }) {
  const confirm = useConfirm();
  const rank = rankOf(staffRole);
  const isApprover = rank >= ROLE_RANK.Manager;
  const [dialog, setDialog] = useState(null); // 'edit' | 'readvertise' | 'transition' | 'close' | 'return' | 'reject' | 'advert'
  const [form, setForm] = useState({});
  const [preview, setPreview] = useState(null);
  const [transition, setTransition] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const done = (message) => { setDialog(null); setError(''); onChanged?.(message); };
  const run = async (fn, message, fallback) => {
    setBusy(true); setError('');
    try {
      const ok = await fn();
      if (ok !== false) done(message);
    } catch (err) {
      // In a dialog the error shows there; from the menu it goes to the page.
      const text = errorText(err, fallback);
      if (dialog) setError(text); else onChanged?.(null, text);
    } finally {
      setBusy(false);
    }
  };

  const openForm = (kind) => { setForm(vacancyToFormFields(v)); setError(''); setDialog(kind); };


  const toDateInputValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const live = ['Open', 'PartiallyFilled'].includes(v.status);
  const transitionDeadlinePassed = v.deadline && new Date(v.deadline) < new Date();

  const items = [
    v.status === 'Returned' && { label: 'Resubmit for approval', onClick: () => run(() => staffClient.patch(`/api/vacancies/${v.id}/resubmit`), 'Resubmitted for approval.', 'Could not resubmit the vacancy') },
    v.status === 'PendingApproval' && isApprover && { label: 'Return for changes', onClick: () => setDialog('return') },
    v.status === 'PendingApproval' && isApprover && { label: 'Reject', danger: true, onClick: () => setDialog('reject') },
    v.status === 'Closed' && isApprover && { label: 'Re-open', onClick: () => run(async () => Boolean(await approveVacancy(v.id, confirm)), 'Vacancy re-opened.', 'Could not re-open the vacancy') },
    v.status === 'Closed' && { label: 'Readvertise…', onClick: () => openForm('readvertise') },
    live && isApprover && (v.postingTypeLocked
      ? { label: 'Posting type locked', disabled: true, hint: 'The posting type was changed after the deadline had passed, so it is now fixed.', onClick: () => {} }
      : { label: `Change to ${v.postingType === 'Internal' ? 'External' : 'Internal'}…`, onClick: () => { setTransition({ target: v.postingType === 'Internal' ? 'External' : 'Internal', deadline: v.deadline ? v.deadline.slice(0, 10) : '' }); setError(''); setDialog('transition'); } }),
    !['Closed', 'Returned', 'Rejected'].includes(v.status) && rank >= ROLE_RANK.Principal_HR_Officer && { divider: true },
    !['Closed', 'Returned', 'Rejected'].includes(v.status) && rank >= ROLE_RANK.Principal_HR_Officer && { label: 'Close vacancy…', danger: true, onClick: () => setDialog('close') }
  ];

  return (
    <>
      <Button variant="ghost" onClick={() => setDialog('advert')}>View advert</Button>
      {v.status !== 'Rejected' && v.status !== 'Closed' && <Button variant="ghost" onClick={() => openForm('edit')}>Edit</Button>}
      <MenuButton items={items} />
      {primary}

      {dialog === 'advert' && (
        <Modal title="Advert as candidates see it" onClose={() => setDialog(null)} maxWidth={720}
          footer={<Button variant="ghost" onClick={() => setDialog(null)}>Close</Button>}>
          <VacancyAdvert {...advertFrom(v, vacancyToFormFields(v))} />
        </Modal>
      )}

      {(dialog === 'edit' || dialog === 'readvertise') && (
        <Modal
          title={dialog === 'edit' ? `Edit vacancy — ${v.jobRef}` : `Readvertise — ${v.jobRef}`}
          onClose={() => setDialog(null)} maxWidth={640}
          footer={<>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setPreview(advertFrom(v, form, dialog === 'readvertise' ? { jobRef: undefined, readvertised: true } : {}))}>Preview advert</Button>
            {dialog === 'edit' ? (
              <Button loading={busy} loadingText="Saving..." onClick={() => run(() => {
                const { deadlineReason, ...fields } = form;
                return staffClient.patch(`/api/vacancies/${v.id}`, { ...fields, reason: deadlineReason || undefined });
              }, 'Changes saved.', 'Could not save changes')}>Save changes</Button>
            ) : (
              <Button loading={busy} loadingText="Publishing..." onClick={() => run(() => staffClient.post(`/api/vacancies/${v.id}/readvertise`, form),
                'Readvertised as a new vacancy - it needs approval before it goes live.', 'Could not readvertise this vacancy')}>Publish for approval</Button>
            )}
          </>}
        >
          <Alert type="error" message={error} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            {dialog === 'edit'
              ? 'Title, department and "reports to" are fixed when the vacancy is created and cannot be changed here.'
              : <>This creates a new vacancy for the same position, filled in from <strong>{v.title}</strong>. Check the details or change anything before publishing. It needs approval again before candidates can see it.</>}
          </p>
          <VacancyForm vacancy={v} form={form} setForm={setForm} mode={dialog} />
        </Modal>
      )}

      {dialog === 'transition' && transition && (
        <Modal title={`Change posting type — ${v.jobRef}`} onClose={() => setDialog(null)}
          footer={<>
            <Button variant="ghost" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>
            <Button loading={busy} loadingText="Changing..." onClick={() => run(() => staffClient.patch(`/api/vacancies/${v.id}/transition-posting-type`, {
              postingType: transition.target, deadline: transition.deadline || null
            }), `Now advertised as ${transition.target}.`, 'Could not change the posting type')}>Change to {transition.target}</Button>
          </>}>
          <Alert type="error" message={error} />
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Change this vacancy from <strong>{v.postingType}</strong> to <strong>{transition.target}</strong>. The change is kept in its history.
            {transitionDeadlinePassed ? ' The deadline has passed, so this will be the last posting-type change allowed on it.' : ''}
          </p>
          {transitionDeadlinePassed && <Alert type="info" message="Candidates can't apply under the new posting type unless you extend the deadline below." />}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {[1, 5, 10].map((days) => (
              <Button key={days} variant="ghost" style={{ padding: '4px 10px' }} onClick={() => {
                const d = new Date(); d.setDate(d.getDate() + days);
                setTransition({ ...transition, deadline: toDateInputValue(d) });
              }}>+{days} day{days > 1 ? 's' : ''}</Button>
            ))}
          </div>
          <TextField label="Deadline" type="date" value={transition.deadline} onChange={(e) => setTransition({ ...transition, deadline: e.target.value })} />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Leave it as it is to keep the current deadline.</p>
        </Modal>
      )}

      {dialog === 'close' && (
        <ReasonDialog title={`Close vacancy — ${v.jobRef}`}
          intro="Closing takes the vacancy off the jobs board and stops new applications. It can be re-opened later. The reason is kept in its history."
          label="Reason for closing" confirmLabel="Close vacancy" busyLabel="Closing..." danger
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await staffClient.patch(`/api/vacancies/${v.id}/close`, { reason }); done('Vacancy closed.'); }} />
      )}

      {(dialog === 'return' || dialog === 'reject') && (
        <ReasonDialog
          title={`${dialog === 'return' ? 'Return' : 'Reject'} vacancy — ${v.jobRef}`}
          intro={dialog === 'return' ? 'HR sees your comment, changes the vacancy and resubmits it.' : 'Rejecting is final. HR sees your reason.'}
          label={dialog === 'return' ? 'What needs to change' : 'Reason'}
          confirmLabel={dialog === 'return' ? 'Return for changes' : 'Reject vacancy'} danger={dialog === 'reject'}
          onClose={() => setDialog(null)}
          onSubmit={async (reason) => { await staffClient.patch(`/api/vacancies/${v.id}/${dialog}`, { reason }); done(dialog === 'return' ? 'Returned to HR for changes.' : 'Vacancy rejected.'); }} />
      )}

      {preview && (
        <Modal title="Advert preview" onClose={() => setPreview(null)} maxWidth={720}
          footer={<Button variant="ghost" onClick={() => setPreview(null)}>Close</Button>}>
          <VacancyAdvert {...preview} />
        </Modal>
      )}

    </>
  );
}
