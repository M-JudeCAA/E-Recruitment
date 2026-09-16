import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import HRSidebar from '../components/HRSidebar';
import Card from '../components/Card';
import TextField from '../components/TextField';
import TextArea from '../components/TextArea';
import Select from '../components/Select';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import VacancyAdvertFields from '../components/VacancyAdvertFields';
import VacancyAdvert from '../components/VacancyAdvert';
import LiveIndicator from '../components/LiveIndicator';
import StatsStrip from '../components/StatsStrip';
import { urgencyOf } from '../utils/slaUrgency';
import { debounce } from '../utils/debounce';

function UrgencyBadge({ followUp }) {
  const urgency = urgencyOf(followUp);
  if (!urgency) return null;
  return <span style={{ fontSize: 11, fontWeight: 700, color: urgency.color, whiteSpace: 'nowrap' }}>{urgency.label}</span>;
}

const VALID_TABS = ['vacancies', 'interviews', 'offers'];

const EMPLOYMENT_CATEGORY_LABELS = { FullTime: 'Full-time', Contract: 'Contract', FixedTermContract: 'Fixed Term Contract' };
// UCAA's actual sites - matches backend/src/utils/vacancyValidation.js's
// VALID_LOCATIONS exactly (confirmed against a real reference "Create
// Job" form).
const LOCATIONS = [
  'Entebbe International Airport', 'UCAA Head Office — Entebbe', 'Kampala HQ',
  'Gulu Aerodrome', 'Jinja Aerodrome', 'Mbarara Aerodrome', 'Fort Portal (Kasese) Aerodrome',
  'Arua Aerodrome', 'Soroti Aerodrome', 'Kidepo Aerodrome'
];

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK. "Close a
// vacancy" remains Principal HR Officer+, unchanged - the vacancy
// approval simplification was scoped narrowly to approval itself.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// A vacancy whose deadline has passed but is still Open/PartiallyFilled
// (Vacancy.status is never mutated just because a deadline lapsed - see
// scripts/checkVacancyDeadlines.js's own comment) needs HR's attention -
// candidates can no longer apply to it, but nothing here told HR that
// without them cross-checking today's date against every listed deadline
// themselves. A vacancy already Closed/Filled isn't "overdue" in this
// sense - it's already been resolved one way or the other.
const isOverdue = (v) => v.deadline && new Date(v.deadline) < new Date() && ['Open', 'PartiallyFilled'].includes(v.status);

export default function HRDashboard() {
  const { staff } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // CHANGED - was Principal_HR_Officer. The vacancy workflow simplified
  // from 5-tier (create -> Senior HR Officer review -> Principal HR
  // Officer approve) to 2-tier: HR Officer creates, Manager or Director
  // approves directly - matching "MHRA or DHRA" exactly. The review step
  // is removed, not just hidden - there is no review stage in the new
  // flow at all.
  const canApprove = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager;
  const canTransition = canApprove; // same tier - their call to it IS the required approval

  const [vacancies, setVacancies] = useState([]);
  const [approvedDepartments, setApprovedDepartments] = useState([]);

  // Set once, on arrival back here from the (now standalone)
  // /hr/vacancies/new page after a successful create - see
  // CreateVacancyListing.jsx's navigate() call.
  const [message, setMessage] = useState(location.state?.vacancyCreatedMessage || '');
  const [error, setError] = useState('');

  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({});
  // Same reasoning as CreateVacancyListing.jsx's customLocation - kept
  // separate from editForm.location itself, and (re)initialized in
  // openEdit based on whether the vacancy's current location is a custom
  // one not on the LOCATIONS list.
  const [editCustomLocation, setEditCustomLocation] = useState(false);

  // Readvertise a Closed vacancy - a separate modal/form from Edit above,
  // since submitting it POSTs a brand new Vacancy (see readvertise() on
  // the backend) rather than PATCHing this one. readvertiseModal holds the
  // closed vacancy being readvertised (source, for header/labels only);
  // readvertiseForm is the editable field set, pre-filled from it, exactly
  // the same shape openEdit builds.
  const [readvertiseModal, setReadvertiseModal] = useState(null);
  const [readvertiseForm, setReadvertiseForm] = useState({});
  const [readvertiseCustomLocation, setReadvertiseCustomLocation] = useState(false);

  // Posting-type transition confirmation - every transition asks whether
  // to extend the deadline or leave it as-is, so this needs a real modal
  // (quick +N-day presets plus a free date picker) rather than the plain
  // confirm() dialog this used to be.
  const [transitionModal, setTransitionModal] = useState(null);

  // Which tab is showing lives in the URL (?tab=...), not local state, so
  // HRSidebar links from other /hr/* pages (and browser back/forward/reload)
  // land on the right tab instead of always resetting to Vacancies.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeSection = VALID_TABS.includes(requestedTab) ? requestedTab : 'vacancies';

  // Interviews/Offers are cross-vacancy views over the small subset of
  // applications with an interview round or an offer. This used to be an
  // N+1 fetch (one request per vacancy, flattened client-side) as a
  // workaround for there being no aggregate endpoint - now there is one
  // (the same GET /api/applications the Application Management queue
  // uses), so this is a single bounded request instead.
  const [crossApps, setCrossApps] = useState(null);
  const [crossLoading, setCrossLoading] = useState(false);
  const [followUps, setFollowUps] = useState([]);

  // `force` bypasses the "already loaded" guard - the normal tab-switch
  // path never needs to re-fetch, but a WS event on the interviews/offers
  // tab does.
  const loadCrossVacancyApplications = useCallback(async (force = false) => {
    if (!force && (crossApps || crossLoading)) return;
    setCrossLoading(true);
    setError('');
    try {
      const res = await staffClient.get('/api/applications', { params: { limit: 500 } });
      setCrossApps(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load applications');
    } finally {
      setCrossLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossApps, crossLoading]);

  useEffect(() => {
    if (['interviews', 'offers'].includes(activeSection)) {
      loadCrossVacancyApplications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const loadFollowUps = useCallback(() => {
    staffClient.get('/api/dashboard/follow-ups').then((res) => setFollowUps(res.data)).catch(() => {});
  }, []);
  useEffect(() => { loadFollowUps(); }, [loadFollowUps]);

  // Shared preview modal - built from the create form or the edit form,
  // whichever is open, so HR can see exactly what candidates will see
  // (the same VacancyAdvert component the candidate-facing apply wizard
  // uses) before ever submitting for approval.
  const [previewData, setPreviewData] = useState(null);

  // Filter bar (#2) - client-side over the already-loaded admin vacancy
  // list, same tradeoff HRHome's widgets make: no extra request, just a
  // derived view over data already in hand.
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [departmentFilter, setDepartmentFilter] = useState('All');

  const load = useCallback(() => staffClient.get('/api/vacancies/admin').then((res) => setVacancies(res.data)), []);

  useEffect(() => {
    load();
    staffClient.get('/api/departments/approved')
      .then((res) => setApprovedDepartments(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load departments'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetches whichever tab is actually showing (plus the SLA lookup) on
  // any dashboard-relevant broadcast - re-derived per render since it needs
  // the current activeSection, but debounced so a burst of events still
  // only triggers one refetch.
  const refetchActiveTab = useCallback(debounce(() => {
    loadFollowUps();
    if (activeSection === 'vacancies') load();
    else loadCrossVacancyApplications(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, 500), [activeSection, load, loadCrossVacancyApplications, loadFollowUps]);
  const { connected } = useDashboardEvents(refetchActiveTab);

  const previewEditForm = () => {
    setPreviewData({
      jobRef: editModal.jobRef,
      title: editModal.title,
      departmentLabel: editModal.department?.name
        ? `${editModal.department.name}${editModal.department.directorate?.name ? ', ' + editModal.department.directorate.name : ''}`
        : null,
      reportsToName: editModal.reportsToPosition?.name,
      salaryScale: editForm.salaryScale, positionsRequired: editForm.positionsRequired, deadline: editForm.deadline,
      location: editForm.location, employmentCategory: editForm.employmentCategory,
      jobPurpose: editForm.jobPurpose, essentialRequirements: editForm.essentialRequirements,
      minimumEducationLevel: editForm.minimumEducationLevel, minimumExperienceYears: editForm.minimumExperienceYears,
      preferredFieldOfStudy: editForm.preferredFieldOfStudy,
      minimumAge: editForm.minimumAge, maximumAge: editForm.maximumAge,
      minimumFlyingHours: editForm.minimumFlyingHours, minimumCGPA: editForm.minimumCGPA, requiredExamGrades: editForm.requiredExamGrades,
      desirableRequirements: editForm.desirableRequirements,
      generalKnowledge: editForm.generalKnowledge, specialSkills: editForm.specialSkills
    });
  };

  const approve = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    }
  };

  // YYYY-MM-DD in local time, matching a <input type="date"> value -
  // toISOString() would drift to UTC and can land on the wrong day.
  const toDateInputValue = (date) => {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  };

  const openTransitionModal = (v) => {
    setError('');
    setTransitionModal({
      vacancy: v,
      target: v.postingType === 'Internal' ? 'External' : 'Internal',
      deadline: v.deadline ? v.deadline.slice(0, 10) : ''
    });
  };

  const quickExtendDeadline = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setTransitionModal((prev) => ({ ...prev, deadline: toDateInputValue(d) }));
  };

  const confirmTransition = async () => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${transitionModal.vacancy.id}/transition-posting-type`, {
        postingType: transitionModal.target, deadline: transitionModal.deadline || null
      });
      setTransitionModal(null);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Transition failed'));
    }
  };

  const closeVacancy = async (id) => {
    setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/close`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not close vacancy');
    }
  };

  // Shared by openEdit and openReadvertise below - both pre-fill a form
  // from an existing vacancy's current editable fields (positionId,
  // departmentId, and reportsToPositionId are fixed and never included
  // here; readvertise() inherits them server-side from the original).
  const vacancyToFormFields = (v) => ({
    positionsRequired: v.positionsRequired, postingType: v.postingType,
    deadline: v.deadline ? v.deadline.slice(0, 10) : '',
    salaryScale: v.salaryScale || '',
    location: v.location || '',
    employmentCategory: v.employmentCategory || '',
    internalSalaryRange: v.internalSalaryRange || '',
    recruiterNotes: v.recruiterNotes || '',
    minimumExperienceYears: v.minimumExperienceYears ?? '',
    minimumEducationLevel: v.minimumEducationLevel || '',
    preferredFieldOfStudy: v.preferredFieldOfStudy || '',
    minimumAge: v.minimumAge ?? '',
    maximumAge: v.maximumAge ?? '',
    minimumFlyingHours: v.minimumFlyingHours ?? '',
    minimumCGPA: v.minimumCGPA ?? '',
    requiredExamGrades: v.requiredExamGrades || [],
    jobPurpose: v.jobPurpose || '',
    essentialRequirements: v.essentialRequirements || [],
    desirableRequirements: v.desirableRequirements || [],
    disqualifyingRequirements: v.disqualifyingRequirements || [],
    generalKnowledge: v.generalKnowledge || [],
    specialSkills: v.specialSkills || []
  });

  // Only the fields that remain editable post-creation - positionId,
  // departmentId, and reportsToPositionId are fixed at creation time.
  const openEdit = (v) => {
    setError('');
    setEditForm(vacancyToFormFields(v));
    setEditCustomLocation(!!(v.location && !LOCATIONS.includes(v.location)));
    setEditModal(v);
  };

  const saveEdit = async () => {
    try {
      await staffClient.patch(`/api/vacancies/${editModal.id}`, editForm);
      setEditModal(null);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Could not save changes'));
    }
  };

  // Readvertising pre-fills the exact same fields as Edit, from the closed
  // vacancy's own values - HR can review them as-is or change anything
  // before submitting, same "check if details are still the same" flow.
  // positionId/departmentId/reportsToPositionId aren't included (and
  // couldn't be edited here even if they were) - readvertise() always
  // inherits those from the original vacancy server-side.
  const openReadvertise = (v) => {
    setError('');
    setReadvertiseForm(vacancyToFormFields(v));
    setReadvertiseCustomLocation(!!(v.location && !LOCATIONS.includes(v.location)));
    setReadvertiseModal(v);
  };

  const previewReadvertiseForm = () => {
    setPreviewData({
      title: readvertiseModal.title,
      departmentLabel: readvertiseModal.department?.name
        ? `${readvertiseModal.department.name}${readvertiseModal.department.directorate?.name ? ', ' + readvertiseModal.department.directorate.name : ''}`
        : null,
      reportsToName: readvertiseModal.reportsToPosition?.name,
      readvertised: true,
      salaryScale: readvertiseForm.salaryScale, positionsRequired: readvertiseForm.positionsRequired, deadline: readvertiseForm.deadline,
      location: readvertiseForm.location, employmentCategory: readvertiseForm.employmentCategory,
      jobPurpose: readvertiseForm.jobPurpose, essentialRequirements: readvertiseForm.essentialRequirements,
      minimumEducationLevel: readvertiseForm.minimumEducationLevel, minimumExperienceYears: readvertiseForm.minimumExperienceYears,
      preferredFieldOfStudy: readvertiseForm.preferredFieldOfStudy,
      minimumAge: readvertiseForm.minimumAge, maximumAge: readvertiseForm.maximumAge,
      minimumFlyingHours: readvertiseForm.minimumFlyingHours, minimumCGPA: readvertiseForm.minimumCGPA, requiredExamGrades: readvertiseForm.requiredExamGrades,
      desirableRequirements: readvertiseForm.desirableRequirements,
      generalKnowledge: readvertiseForm.generalKnowledge, specialSkills: readvertiseForm.specialSkills
    });
  };

  const submitReadvertise = async () => {
    setError('');
    try {
      await staffClient.post(`/api/vacancies/${readvertiseModal.id}/readvertise`, readvertiseForm);
      setReadvertiseModal(null);
      setMessage('Vacancy readvertised - it now needs approval before it goes live.');
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Could not readvertise this vacancy'));
    }
  };

  const filteredVacancies = vacancies.filter((v) => {
    if (statusFilter !== 'All' && v.status !== statusFilter) return false;
    if (departmentFilter !== 'All' && String(v.departmentId) !== departmentFilter) return false;
    const q = searchText.trim().toLowerCase();
    if (q && !v.title.toLowerCase().includes(q) && !v.jobRef.toLowerCase().includes(q)) return false;
    return true;
  });

  // Display-only ordering over the filtered results - overdue-and-still-
  // active vacancies surface first so they aren't missed among newer
  // ones, without disturbing findManyForAdmin's createdAt-desc order for
  // everything else.
  const sortedVacancies = [...filteredVacancies].sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)));

  const transitionDeadlinePassed = transitionModal?.vacancy.deadline && new Date(transitionModal.vacancy.deadline) < new Date();

  // Vacancies tab strip - totals over the full (unfiltered) list, same
  // "always the full picture regardless of the filter bar" convention as
  // HRHome's own KPI tiles.
  const vacancyStats = [
    { label: 'Open', value: vacancies.filter((v) => v.status === 'Open').length, color: 'var(--color-accent)' },
    { label: 'Pending approval', value: vacancies.filter((v) => v.status === 'PendingApproval').length, color: 'var(--color-warning)' },
    { label: 'Closed', value: vacancies.filter((v) => v.status === 'Closed').length, color: 'var(--color-text-muted)' }
  ];
  const allRounds = (crossApps || []).flatMap((app) => app.interviewRounds || []);
  const interviewStats = [
    { label: 'Shortlist', value: allRounds.filter((r) => r.recommendation === 'Shortlist').length, color: 'var(--color-accent)' },
    { label: 'Hold', value: allRounds.filter((r) => r.recommendation === 'Hold').length, color: 'var(--color-warning)' },
    { label: 'Reject', value: allRounds.filter((r) => r.recommendation === 'Reject').length, color: 'var(--color-danger)' },
    { label: 'Awaiting a score', value: allRounds.filter((r) => r.score == null).length, color: 'var(--color-text-muted)' }
  ];
  const offerStatuses = (crossApps || []).filter((app) => app.offer).map((app) => app.offer.status);
  const offerStats = ['Recommended', 'Approved', 'Extended', 'Accepted', 'Declined'].map((status) => ({
    label: status, value: offerStatuses.filter((s) => s === status).length
  }));

  return (
    <div>
      {/* "HR dashboard" title and "Logged in as ..." now live in the
          navbar's profile chip instead - see Navbar.jsx. */}
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active={activeSection} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeSection !== 'vacancies' && <Alert type="error" message={error} />}

          {activeSection === 'vacancies' && (
            <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h3 style={{ margin: 0 }}>Vacancies</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LiveIndicator connected={connected} />
          <Button onClick={() => navigate('/hr/vacancies/new')}>+ New Listing</Button>
        </div>
      </div>

      <StatsStrip stats={vacancyStats} />

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      {/* Filter bar (#2) - text search plus status/department filters over
          the already-loaded admin vacancy list. */}
      <Card style={{ marginBottom: 'var(--spacing-md)' }}>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            label="Search"
            placeholder="Title or job ref"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ flex: '2 1 220px' }}
          />
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ flex: '1 1 160px' }}>
            <option value="All">All statuses</option>
            <option value="PendingApproval">Pending approval</option>
            <option value="Open">Open</option>
            <option value="PartiallyFilled">Partially filled</option>
            <option value="Filled">Filled</option>
            <option value="Closed">Closed</option>
          </Select>
          <Select label="Department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} style={{ flex: '1 1 200px' }}>
            <option value="All">All departments</option>
            {approvedDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
      </Card>

      {sortedVacancies.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            {vacancies.length === 0 ? 'No vacancies yet.' : 'No vacancies match these filters.'}
          </p>
        </Card>
      ) : (
      sortedVacancies.map((v) => (
        <Card key={v.id} accent={isOverdue(v) ? 'var(--color-danger)' : undefined}>
          {/* Header: title reads as the actual heading (was buried mid-
              sentence after the jobRef); status + application count form
              a right-aligned cluster instead of running into the title
              line, so both are scannable at a glance down a long list. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {v.title}
                {v.readvertisedFromId != null && <StatusBadge status="Readvertised" />}
                {v.status === 'PendingApproval' && <UrgencyBadge followUp={followUps.find((f) => f.taskType === 'VacancyApproval' && f.taskId === v.id)} />}
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {v.jobRef}
                {' '}&middot; {v.department?.directorate?.name} &mdash; {v.department?.name}
                {v.reportsToPosition && <> &middot; Reports to {v.reportsToPosition.name}</>}
                {v.deadline && (
                  <span style={{ fontWeight: isOverdue(v) ? 600 : 400, color: isOverdue(v) ? 'var(--color-danger)' : 'inherit' }}>
                    {' '}&middot; {isOverdue(v) ? 'Deadline passed' : 'Deadline'} {new Date(v.deadline).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <StatusBadge status={v.status} />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {v._count?.applications ?? 0} application{v._count?.applications === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Action toolbar: right-aligned, every action the same size/
              spacing, separated from the header by a rule - was a left-
              flowing mix of a plain Link and several differently-spaced
              Buttons that visually competed with each other. */}
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8,
              marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)'
            }}
          >
            {/* Inactive while PendingApproval - the vacancy hasn't been
                published yet, so there is nothing legitimate to review
                (see applicationEligibility.js's status gate, which candidates
                are meant to be blocked by before ever reaching this vacancy).
                Every other status has been published at least once. */}
            {v.status === 'PendingApproval' ? (
              <span
                title="Applications become viewable once this vacancy is approved and published"
                style={{ padding: '4px 10px', fontSize: 13, color: 'var(--color-text-muted)', cursor: 'not-allowed' }}
              >
                View applications
              </span>
            ) : (
              <Link to={`/hr/applications?vacancyId=${v.id}`} style={{ padding: '4px 10px', fontSize: 13 }}>View applications</Link>
            )}
            <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => openEdit(v)}>Edit</Button>
            {/* SIMPLIFIED - the Senior HR Officer review stage and its
                "awaiting review" status line are both removed entirely,
                not just hidden. The 2-tier flow goes straight from
                PendingApproval to a Manager/Director's direct approval. */}
            {v.status === 'PendingApproval' && canApprove && (
              <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => approve(v.id)}>Approve</Button>
            )}
            {v.status === 'Closed' && canApprove && (
              <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => approve(v.id)}>Re-open</Button>
            )}
            {v.status === 'Closed' && (
              <Button variant="secondary" style={{ padding: '4px 10px' }} onClick={() => openReadvertise(v)}>Readvertise</Button>
            )}
            {/* Internal <-> External transition, restricted to the same
                Manager/Director tier as approval, and only while the
                vacancy is actually live (Open/PartiallyFilled) - matches
                the server-side guard in transitionPostingType() exactly,
                so this button never appears somewhere the backend would
                refuse it anyway. Locked once a transition was made while
                the deadline had already passed (postingTypeLocked) - no
                further transitions allowed on this vacancy at all. */}
            {['Open', 'PartiallyFilled'].includes(v.status) && canTransition && (
              v.postingTypeLocked ? (
                <span
                  title="This vacancy's posting type was changed after its deadline had passed, and is now locked"
                  style={{ padding: '4px 10px', fontSize: 13, color: 'var(--color-text-muted)', cursor: 'not-allowed' }}
                >
                  Posting type locked
                </span>
              ) : (
                <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => openTransitionModal(v)}>
                  Transition to {v.postingType === 'Internal' ? 'External' : 'Internal'}
                </Button>
              )
            )}
            {v.status !== 'Closed' && canApprove && (
              <Button variant="ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)' }}
                onClick={() => closeVacancy(v.id)}>Close vacancy</Button>
            )}
          </div>
        </Card>
      ))
      )}

      {editModal && (
        <Modal
          title={`Edit vacancy — ${editModal.jobRef}`}
          onClose={() => setEditModal(null)}
          maxWidth={640}
          footer={<>
            <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button variant="secondary" onClick={previewEditForm}>Preview advert</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </>}
        >
          <Alert type="error" message={error} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Title, Department, and Reports To are fixed at creation and cannot be changed here.
          </p>
          <TextField label="Positions required" type="number" min="1" value={editForm.positionsRequired}
            onChange={(e) => setEditForm({ ...editForm, positionsRequired: Number(e.target.value) })} />
          {/* This plain edit-form Select is for pre-approval changes only
              (no audit trail beyond ordinary editing). Once a vacancy is
              actually Open/PartiallyFilled, changing posting type here is
              blocked server-side - use the audited Transition action on
              the vacancy card instead, which is the only path once it's live. */}
          <Select label="Posting type" value={editForm.postingType} onChange={(e) => setEditForm({ ...editForm, postingType: e.target.value })} required>
            <option value="">Select one</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={editForm.deadline}
            onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
          <TextField label="Salary level / scale" value={editForm.salaryScale}
            onChange={(e) => setEditForm({ ...editForm, salaryScale: e.target.value })} />
          <Select label="Location" value={editCustomLocation ? '__custom__' : editForm.location}
            onChange={(e) => {
              if (e.target.value === '__custom__') { setEditCustomLocation(true); }
              else { setEditCustomLocation(false); setEditForm({ ...editForm, location: e.target.value }); }
            }}>
            <option value="">Not specified</option>
            {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            <option value="__custom__">Other (specify)</option>
          </Select>
          {editCustomLocation && (
            <TextField label="Custom location" placeholder="e.g. a new site not listed above"
              value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
          )}
          <Select label="Employment category" value={editForm.employmentCategory}
            onChange={(e) => setEditForm({ ...editForm, employmentCategory: e.target.value })}>
            <option value="">Not specified</option>
            {Object.entries(EMPLOYMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <TextField label="Internal salary range (HR only - never shown to candidates)" value={editForm.internalSalaryRange}
            onChange={(e) => setEditForm({ ...editForm, internalSalaryRange: e.target.value })} />
          <TextArea label="Notes for recruiters (HR only)" rows={2} value={editForm.recruiterNotes}
            onChange={(e) => setEditForm({ ...editForm, recruiterNotes: e.target.value })} />
          <VacancyAdvertFields values={editForm} onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))} />
        </Modal>
      )}

      {readvertiseModal && (
        <Modal
          title={`Readvertise — ${readvertiseModal.jobRef}`}
          onClose={() => setReadvertiseModal(null)}
          maxWidth={640}
          footer={<>
            <Button variant="ghost" onClick={() => setReadvertiseModal(null)}>Cancel</Button>
            <Button variant="secondary" onClick={previewReadvertiseForm}>Preview advert</Button>
            <Button onClick={submitReadvertise}>Publish for approval</Button>
          </>}
        >
          <Alert type="error" message={error} />
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            This creates a brand new vacancy for the same position, pre-filled from{' '}
            <strong>{readvertiseModal.title}</strong> below - review the details as they are, or change
            anything before publishing. It needs approval again before it's visible to candidates.
          </p>
          <TextField label="Positions required" type="number" min="1" value={readvertiseForm.positionsRequired}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, positionsRequired: Number(e.target.value) })} />
          <Select label="Posting type" value={readvertiseForm.postingType} onChange={(e) => setReadvertiseForm({ ...readvertiseForm, postingType: e.target.value })} required>
            <option value="">Select one</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <TextField label="Deadline" type="date" value={readvertiseForm.deadline}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, deadline: e.target.value })} />
          <TextField label="Salary level / scale" value={readvertiseForm.salaryScale}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, salaryScale: e.target.value })} />
          <Select label="Location" value={readvertiseCustomLocation ? '__custom__' : readvertiseForm.location}
            onChange={(e) => {
              if (e.target.value === '__custom__') { setReadvertiseCustomLocation(true); }
              else { setReadvertiseCustomLocation(false); setReadvertiseForm({ ...readvertiseForm, location: e.target.value }); }
            }}>
            <option value="">Not specified</option>
            {LOCATIONS.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            <option value="__custom__">Other (specify)</option>
          </Select>
          {readvertiseCustomLocation && (
            <TextField label="Custom location" placeholder="e.g. a new site not listed above"
              value={readvertiseForm.location} onChange={(e) => setReadvertiseForm({ ...readvertiseForm, location: e.target.value })} />
          )}
          <Select label="Employment category" value={readvertiseForm.employmentCategory}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, employmentCategory: e.target.value })}>
            <option value="">Not specified</option>
            {Object.entries(EMPLOYMENT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <TextField label="Internal salary range (HR only - never shown to candidates)" value={readvertiseForm.internalSalaryRange}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, internalSalaryRange: e.target.value })} />
          <TextArea label="Notes for recruiters (HR only)" rows={2} value={readvertiseForm.recruiterNotes}
            onChange={(e) => setReadvertiseForm({ ...readvertiseForm, recruiterNotes: e.target.value })} />
          <VacancyAdvertFields values={readvertiseForm} onChange={(patch) => setReadvertiseForm((prev) => ({ ...prev, ...patch }))} />
        </Modal>
      )}

      {transitionModal && (
        <Modal
          title={`Transition posting type — ${transitionModal.vacancy.jobRef}`}
          onClose={() => setTransitionModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setTransitionModal(null)}>Cancel</Button>
            <Button onClick={confirmTransition}>Transition to {transitionModal.target}</Button>
          </>}
        >
          <Alert type="error" message={error} />
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Transition this vacancy from <strong>{transitionModal.vacancy.postingType}</strong> to{' '}
            <strong>{transitionModal.target}</strong>. This is audited.
            {transitionDeadlinePassed
              ? ' Since this vacancy\'s deadline has already passed, this will be the last posting-type transition allowed on it.'
              : ''}
          </p>
          {transitionDeadlinePassed && (
            <Alert type="info" message="This vacancy's deadline has already passed - candidates still won't be able to apply under the new posting type unless you extend the deadline below." />
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => quickExtendDeadline(1)}>+1 day</Button>
            <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => quickExtendDeadline(5)}>+5 days</Button>
            <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => quickExtendDeadline(10)}>+10 days</Button>
          </div>
          <TextField label="Deadline" type="date" value={transitionModal.deadline}
            onChange={(e) => setTransitionModal({ ...transitionModal, deadline: e.target.value })} />
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Use a quick preset above, pick a custom date, or leave this as it is to keep the current deadline unchanged.
          </p>
        </Modal>
      )}

      {previewData && (
        <Modal title="Vacancy advert preview" onClose={() => setPreviewData(null)} maxWidth={720}
          footer={<Button variant="ghost" onClick={() => setPreviewData(null)}>Close</Button>}>
          <VacancyAdvert {...previewData} />
        </Modal>
      )}
            </>
          )}

          {activeSection === 'interviews' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Interviews</h3>
                <LiveIndicator connected={connected} />
              </div>
              <StatsStrip stats={interviewStats} />
              {crossLoading && <p>Loading interviews...</p>}
              {crossApps && crossApps.filter((app) => app.interviewRounds?.length > 0).length === 0 && (
                <p>No interviews scheduled yet.</p>
              )}
              {crossApps && crossApps.filter((app) => app.interviewRounds?.length > 0).map((app) => (
                <Card key={app.id}>
                  <strong>{app.candidate.fullName}</strong> &mdash; {app.vacancy.jobRef} ({app.vacancy.title})
                  <div style={{ marginTop: 6 }}>
                    {app.interviewRounds.map((r) => (
                      <div key={r.id} style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                        Round {r.roundNumber}
                        {' '}&middot; {r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : 'unscheduled'}
                        {' '}&middot; {r.mode}
                        {r.score != null && <> &middot; average {r.score.toFixed(1)}</>}
                        {r.recommendation && <> &middot; <StatusBadge status={r.recommendation} /></>}
                      </div>
                    ))}
                  </div>
                  <Link to={`/hr/applications?vacancyId=${app.vacancy.id}`}>Manage in Application Management &rarr;</Link>
                </Card>
              ))}
            </div>
          )}

          {activeSection === 'offers' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Offers</h3>
                <LiveIndicator connected={connected} />
              </div>
              <StatsStrip stats={offerStats} />
              {crossLoading && <p>Loading offers...</p>}
              {crossApps && crossApps.filter((app) => app.offer).length === 0 && <p>No offers recommended yet.</p>}
              {crossApps && crossApps.filter((app) => app.offer).map((app) => (
                <Card key={app.id}>
                  <strong>{app.candidate.fullName}</strong> &mdash; {app.vacancy.jobRef} ({app.vacancy.title})
                  {' '}&middot; Offer: <StatusBadge status={app.offer.status} />
                  <div style={{ marginTop: 6 }}>
                    <Link to={`/hr/applications?vacancyId=${app.vacancy.id}`}>Manage in Application Management &rarr;</Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
