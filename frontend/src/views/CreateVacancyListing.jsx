import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, CalendarClock, FileText } from 'lucide-react';
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

const emptyForm = {
  departmentId: '', positionId: '', reportsToPositionId: '',
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
  desirableRequirements: [], disqualifyingRequirements: [], generalKnowledge: [], specialSkills: []
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
  const [form, setForm] = useState(emptyForm);
  // Separate from form.location itself - lets "Other" stay selected (and
  // its text input visible) while the candidate types, even though the
  // in-progress value isn't one of LOCATIONS and may briefly be empty.
  const [customLocation, setCustomLocation] = useState(false);
  const [creating, setCreating] = useState(false); // double-submission lock
  const [error, setError] = useState('');
  const [previewData, setPreviewData] = useState(null);

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
    const res = await staffClient.get(`/api/departments/${departmentId}/positions`);
    setDepartmentPositions(res.data);
  };

  // Step 2: Position (Title) chosen - loads senior positions for Reports To.
  const handlePositionChange = async (positionId) => {
    setForm({ ...form, positionId, reportsToPositionId: '' });
    if (!positionId) { setReportsToOptions([]); return; }
    const res = await staffClient.get(`/api/positions/${positionId}/senior-options`);
    setReportsToOptions(res.data);
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
      generalKnowledge: form.generalKnowledge, specialSkills: form.specialSkills
    });
  };

  const createVacancy = async (e) => {
    e.preventDefault();
    if (creating) return; // a double-click or slow-network retry must not create two vacancies
    setError(''); setCreating(true);
    try {
      const res = await staffClient.post('/api/vacancies', form);
      navigate('/hr', { state: { vacancyCreatedMessage: `Vacancy created (Ref: ${res.data.jobRef}). It needs Manager or Director approval to open.` } });
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Failed to create vacancy'));
      setCreating(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="vacancies" />

        <div style={{ flex: 1, minWidth: 0 }}>
      <PageHeader title="New Listing" subtitle="Create a new vacancy for approval" />
      <p style={{ marginTop: -12, marginBottom: 'var(--spacing-md)' }}>
        <Link to="/hr">&larr; Back to vacancies</Link>
      </p>

      <Alert type="error" message={error} />

      <form onSubmit={createVacancy} style={{ maxWidth: 820 }}>
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
              <Select label="Title" required value={form.positionId} onChange={(e) => handlePositionChange(e.target.value)} disabled={!form.departmentId}>
                <option value="">{form.departmentId ? 'Select a position' : 'Select a department first'}</option>
                {departmentPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {form.departmentId && departmentPositions.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -14 }}>
                  No positions yet. <Link to="/hr/departments">Add one</Link>.
                </p>
              )}
            </div>
            <div>
              <Select label="Reports to" value={form.reportsToPositionId}
                onChange={(e) => setForm({ ...form, reportsToPositionId: e.target.value })} disabled={!form.positionId}>
                <option value="">{form.positionId ? 'Select a position (optional)' : 'Select a title first'}</option>
                {reportsToOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              {form.positionId && reportsToOptions.length === 0 && (
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
          <SectionHeader icon={CalendarClock} title="Listing details"
            description="Timeline and compensation. The internal salary range and recruiter notes are never shown to candidates." />

          <div style={fieldGrid}>
            <TextField label="Deadline" type="date" value={form.deadline}
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
            description="The actual advert content - what candidates read and answer when they apply." />
          <VacancyAdvertFields values={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />
        </Card>

        {/* Actions live in their own visually distinct bar at the bottom,
            not just another row inside the last card - a form this length
            benefits from a clear, deliberate "you're done, here's what
            happens next" moment rather than the buttons blending into
            whatever section happened to be last. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
          background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
          padding: 'var(--spacing-md) var(--spacing-lg)', marginTop: 'var(--spacing-md)'
        }}>
          <Button type="button" variant="ghost" onClick={() => navigate('/hr')}>Cancel</Button>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button type="button" variant="secondary" onClick={previewForm}>Preview advert</Button>
            <Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create listing'}</Button>
          </div>
        </div>
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
