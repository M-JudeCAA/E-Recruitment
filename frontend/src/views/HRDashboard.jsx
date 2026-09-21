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
import Skeleton from '../components/Skeleton';
import ViewSwitcher from '../components/ViewSwitcher';
import DataTable from '../components/DataTable';
import BoardView from '../components/BoardView';
import LoadMoreControl from '../components/LoadMoreControl';
import { STATUS_COLORS } from '../components/StatusBadge';
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

const MS_PER_DAY = 86400000;

// "N days left" countdown alongside the deadline date itself - the deadline
// line previously only spoke up once a vacancy was already overdue; this
// gives the same "closing soon" signal HRHome's own panel already shows,
// directly on the card instead of a separate screen. Amber inside a week,
// muted otherwise; isOverdue's own red "Deadline passed" styling is
// untouched and takes precedence (this only renders while not overdue).
function daysLeftLabel(deadline) {
  const daysLeft = Math.ceil((new Date(deadline).getTime() - Date.now()) / MS_PER_DAY);
  if (daysLeft === 0) return { text: 'today', urgent: true };
  if (daysLeft === 1) return { text: 'tomorrow', urgent: true };
  return { text: `in ${daysLeft} days`, urgent: daysLeft <= 7 };
}

// Mimics the Interviews/Offers tabs' own card rows (name + vacancy line)
// so the cross-vacancy queue doesn't visibly jump in layout once the real
// list lands - see Skeleton.jsx's own comment for why this beats a plain
// "Loading..." string here.
function CrossQueueRowSkeleton() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <Skeleton width={`${50 - i * 6}%`} height={15} style={{ marginBottom: 8 }} />
          <Skeleton width="30%" height={12} />
        </Card>
      ))}
    </>
  );
}

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
  const [loadingVacancies, setLoadingVacancies] = useState(true);
  const [approvedDepartments, setApprovedDepartments] = useState([]);
  // Which per-row action (if any) is currently in flight for the selected
  // vacancy's detail panel - a single key rather than one flag per action
  // is enough since only one vacancy's actions render at a time (the
  // master-detail layout), but it still has to be a key, not a bare
  // boolean, since Approve and Close vacancy can both be visible on the
  // same PendingApproval vacancy at once.
  const [rowActionBusy, setRowActionBusy] = useState(null); // 'approve' | 'close' | null
  const [savingEdit, setSavingEdit] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [readvertising, setReadvertising] = useState(false);

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
  const [searchParams, setSearchParams] = useSearchParams();
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
  // derived view over data already in hand. Initial values read from the
  // URL (?q=&status=&dept=&postingType=&directorate=&sort=) so a refresh
  // or a shared link restores the same view instead of silently resetting
  // to "All" - kept separate from the `tab` param's own handling above.
  const [searchText, setSearchText] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All');
  const [departmentFilter, setDepartmentFilter] = useState(searchParams.get('dept') || 'All');
  const [postingTypeFilter, setPostingTypeFilter] = useState(searchParams.get('postingType') || 'All');
  const [directorateFilter, setDirectorateFilter] = useState(searchParams.get('directorate') || 'All');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'urgent');
  // List/Table/Board - shared across every tab (Vacancies/Interviews/
  // Offers) that offers a ViewSwitcher, same as `tab` itself, since only
  // one tab's content is ever on screen to read it.
  const [view, setView] = useState(searchParams.get('view') || 'list');
  // Which vacancy the master-detail split's detail pane shows - not synced
  // to the URL (unlike the filters above); it's a within-page focus, not a
  // navigable destination, and defaults to the first result via
  // `selectedVacancy` below whenever nothing (or a now-filtered-out id) is
  // selected, so switching filters never leaves the pane empty.
  const [selectedVacancyId, setSelectedVacancyId] = useState(null);

  // Keeps the URL in sync as filters change (replace, not push - filtering
  // isn't a "back button" moment) without disturbing `tab` or any other
  // param already present. Runs after every filter-state change, not on a
  // `searchParams` dependency, to avoid a set-triggers-rerun-triggers-set
  // loop; the effect always reads the latest `searchParams` from the
  // render closure regardless.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrClear = (key, value, blank) => (!value || value === blank ? next.delete(key) : next.set(key, value));
    setOrClear('q', searchText, '');
    setOrClear('status', statusFilter, 'All');
    setOrClear('dept', departmentFilter, 'All');
    setOrClear('postingType', postingTypeFilter, 'All');
    setOrClear('directorate', directorateFilter, 'All');
    setOrClear('sort', sortBy, 'urgent');
    setOrClear('view', view, 'list');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, statusFilter, departmentFilter, postingTypeFilter, directorateFilter, sortBy, view]);

  // Display-only cap on how many filtered/sorted results render at once,
  // with a "Load more" step rather than true server-side pagination -
  // GET /api/vacancies/admin already returns the full list in one bounded
  // request (the same tradeoff this file's other widgets make), so this
  // only needs to bound the DOM, not the fetch. Resets to the first page
  // whenever a filter changes, so a narrower result set is never hidden
  // behind a stale "load more" position from a wider one.
  const VACANCY_PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(VACANCY_PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(VACANCY_PAGE_SIZE);
  }, [searchText, statusFilter, departmentFilter, postingTypeFilter, directorateFilter, sortBy]);

  // Same "Load more" cap as Vacancies' own visibleCount above, applied to
  // the Interviews/Offers tabs - crossApps is already fetched whole (one
  // bounded request, up to 500), so this only bounds the DOM, not another
  // fetch. Separate from visibleCount since either tab's scroll position
  // shouldn't reset the other's.
  const CROSS_PAGE_SIZE = 20;
  const [interviewsVisibleCount, setInterviewsVisibleCount] = useState(CROSS_PAGE_SIZE);
  const [offersVisibleCount, setOffersVisibleCount] = useState(CROSS_PAGE_SIZE);

  // setLoadingVacancies(true) is deliberately NOT reset to true on every
  // call - only the initial mount call should show the full-page
  // LoadingState; a background refetch (filter-driven reload, the
  // WS-triggered refetchActiveTab below) should update the list in place
  // without flashing the loading view over data that's already on screen.
  const load = useCallback(() => staffClient.get('/api/vacancies/admin')
    .then((res) => setVacancies(res.data))
    .finally(() => setLoadingVacancies(false)), []);

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
    setError(''); setRowActionBusy('approve');
    try {
      await staffClient.patch(`/api/vacancies/${id}/approve`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed');
    } finally {
      setRowActionBusy(null);
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
    setError(''); setTransitioning(true);
    try {
      await staffClient.patch(`/api/vacancies/${transitionModal.vacancy.id}/transition-posting-type`, {
        postingType: transitionModal.target, deadline: transitionModal.deadline || null
      });
      setTransitionModal(null);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Transition failed'));
    } finally {
      setTransitioning(false);
    }
  };

  const closeVacancy = async (id) => {
    setError(''); setRowActionBusy('close');
    try {
      await staffClient.patch(`/api/vacancies/${id}/close`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not close vacancy');
    } finally {
      setRowActionBusy(null);
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
    setSavingEdit(true);
    try {
      await staffClient.patch(`/api/vacancies/${editModal.id}`, editForm);
      setEditModal(null);
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Could not save changes'));
    } finally {
      setSavingEdit(false);
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
    setError(''); setReadvertising(true);
    try {
      await staffClient.post(`/api/vacancies/${readvertiseModal.id}/readvertise`, readvertiseForm);
      setReadvertiseModal(null);
      setMessage('Vacancy readvertised - it now needs approval before it goes live.');
      load();
    } catch (err) {
      const errs = err.response?.data?.errors;
      setError(errs ? errs.join('; ') : (err.response?.data?.error || 'Could not readvertise this vacancy'));
    } finally {
      setReadvertising(false);
    }
  };

  // Directorate options derived from the vacancy list itself (already
  // includes department.directorate via findManyForAdmin's include) rather
  // than a separate fetch - same "no extra request" tradeoff as the rest
  // of this filter bar.
  const directorateOptions = [...new Set(
    vacancies.map((v) => v.department?.directorate?.name).filter(Boolean)
  )].sort();

  const filteredVacancies = vacancies.filter((v) => {
    if (statusFilter !== 'All' && v.status !== statusFilter) return false;
    if (departmentFilter !== 'All' && String(v.departmentId) !== departmentFilter) return false;
    if (postingTypeFilter !== 'All' && v.postingType !== postingTypeFilter) return false;
    if (directorateFilter !== 'All' && v.department?.directorate?.name !== directorateFilter) return false;
    const q = searchText.trim().toLowerCase();
    if (q && !v.title.toLowerCase().includes(q) && !v.jobRef.toLowerCase().includes(q)) return false;
    return true;
  });

  // "Most urgent" (default) surfaces overdue-and-still-active vacancies
  // first, same as before; the other options are a flat re-sort. `Array.sort`
  // is spec-stable, so "Newest first" (already findManyForAdmin's own
  // createdAt-desc order) is a true no-op comparator rather than a second
  // sort key to maintain.
  const SORTERS = {
    urgent: (a, b) => Number(isOverdue(b)) - Number(isOverdue(a)),
    newest: () => 0,
    deadline: (a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    },
    applications: (a, b) => (b._count?.applications ?? 0) - (a._count?.applications ?? 0)
  };
  const sortedVacancies = [...filteredVacancies].sort(SORTERS[sortBy] || SORTERS.urgent);
  const visibleVacancies = sortedVacancies.slice(0, visibleCount);
  const selectedVacancy = sortedVacancies.find((v) => v.id === selectedVacancyId) || sortedVacancies[0] || null;

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Vacancies</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <LiveIndicator connected={connected} />
          <ViewSwitcher view={view} onChange={setView} />
          <Button onClick={() => navigate('/hr/vacancies/new')}>+ New Listing</Button>
        </div>
      </div>

      <StatsStrip stats={vacancyStats} />

      <Alert type="success" message={message} />
      <Alert type="error" message={error} />

      {/* Filter bar (#2) - text search plus status/department/posting-type/
          directorate filters and a sort order, all over the already-loaded
          admin vacancy list, and synced to the URL (see the effect above)
          so a refresh or a shared link keeps the same view. */}
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
          <Select label="Directorate" value={directorateFilter} onChange={(e) => setDirectorateFilter(e.target.value)} style={{ flex: '1 1 170px' }}>
            <option value="All">All directorates</option>
            {directorateOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
          <Select label="Posting type" value={postingTypeFilter} onChange={(e) => setPostingTypeFilter(e.target.value)} style={{ flex: '1 1 150px' }}>
            <option value="All">Internal & External</option>
            <option value="Internal">Internal only</option>
            <option value="External">External only</option>
          </Select>
          <Select label="Sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ flex: '1 1 170px' }}>
            <option value="urgent">Most urgent first</option>
            <option value="newest">Newest first</option>
            <option value="deadline">Deadline soonest</option>
            <option value="applications">Most applications</option>
          </Select>
        </div>
      </Card>

      {loadingVacancies ? (
        // Mimics the actual master-detail shape below (list rows + a
        // selected-detail panel) rather than a generic spinner, so the
        // page doesn't visibly jump in layout once the real data lands -
        // see Skeleton.jsx's own comment for when to prefer this over
        // LoadingState.
        <div className="flex flex-col md:flex-row" style={{ gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
          <div className="w-full md:w-[380px]" style={{ flexShrink: 0 }}>
            <Card style={{ marginBottom: 0, padding: 0, overflow: 'hidden' }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} style={{ padding: '10px 12px', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                    <Skeleton width={`${60 - i * 5}%`} height={14} />
                    <Skeleton width={58} height={18} radius={999} />
                  </div>
                  <Skeleton width="75%" height={11} style={{ marginBottom: 5 }} />
                  <Skeleton width="35%" height={10} />
                </div>
              ))}
            </Card>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Card style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
                <Skeleton width="55%" height={22} />
                <Skeleton width={90} height={22} radius={999} />
              </div>
              <Skeleton width="85%" height={12} style={{ marginBottom: 8 }} />
              <Skeleton width="60%" height={12} style={{ marginBottom: 24 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <Skeleton width={100} height={32} radius={6} />
                <Skeleton width={70} height={32} radius={6} />
                <Skeleton width={130} height={32} radius={6} />
              </div>
            </Card>
          </div>
        </div>
      ) : sortedVacancies.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            {vacancies.length === 0 ? 'No vacancies yet.' : 'No vacancies match these filters.'}
          </p>
        </Card>
      ) : view === 'table' ? (
        // Dense grid alternative to the master-detail list - a row click
        // selects that vacancy and drops back to List view, so Table never
        // needs its own copy of the action toolbar.
        <>
        <Card style={{ padding: 0 }}>
          <DataTable
            getRowKey={(v) => v.id}
            onRowClick={(v) => { setSelectedVacancyId(v.id); setView('list'); }}
            rows={visibleVacancies}
            columns={[
              { key: 'title', label: 'Title', render: (v) => <span style={{ fontWeight: 600 }}>{v.title}</span> },
              { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v.status} /> },
              { key: 'department', label: 'Department', render: (v) => v.department?.name || '—' },
              { key: 'postingType', label: 'Type', render: (v) => v.postingType },
              {
                key: 'deadline', label: 'Deadline', render: (v) => {
                  if (!v.deadline) return '—';
                  const overdue = isOverdue(v);
                  const info = !overdue && daysLeftLabel(v.deadline);
                  return (
                    <span style={{ color: overdue ? 'var(--color-danger)' : info?.urgent ? 'var(--color-warning)' : 'var(--color-text)' }}>
                      {overdue ? 'Overdue' : info.text}
                    </span>
                  );
                }
              },
              { key: 'apps', label: 'Apps', align: 'right', render: (v) => v._count?.applications ?? 0 }
            ]}
          />
        </Card>
        <LoadMoreControl total={sortedVacancies.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount((c) => c + VACANCY_PAGE_SIZE)} />
        </>
      ) : view === 'board' ? (
        // Grouped by status - vacancies are naturally pipeline-shaped
        // (PendingApproval -> Open/PartiallyFilled -> Filled/Closed), so a
        // board reads at a glance the way the master-detail list can't.
        // Same "click selects + drops to List" interaction as Table.
        <>
        <BoardView
          getItemKey={(v) => v.id}
          items={visibleVacancies}
          groupBy={(v) => v.status}
          columns={[
            { key: 'PendingApproval', label: 'Pending approval', color: STATUS_COLORS.PendingApproval },
            { key: 'Open', label: 'Open', color: STATUS_COLORS.Open },
            { key: 'PartiallyFilled', label: 'Partially filled', color: STATUS_COLORS.PartiallyFilled },
            { key: 'Filled', label: 'Filled', color: STATUS_COLORS.Filled },
            { key: 'Closed', label: 'Closed', color: STATUS_COLORS.Closed }
          ]}
          renderCard={(v) => {
            const overdue = isOverdue(v);
            return (
              <Card
                onClick={() => { setSelectedVacancyId(v.id); setView('list'); }}
                style={{ marginBottom: 0, padding: 10 }}
                accent={overdue ? 'var(--color-danger)' : undefined}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{v.title}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {v.department?.name} &middot; {v.postingType}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {v._count?.applications ?? 0} application{v._count?.applications === 1 ? '' : 's'}
                  {overdue && <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}> &middot; overdue</span>}
                </div>
              </Card>
            );
          }}
        />
        <LoadMoreControl total={sortedVacancies.length} visibleCount={visibleCount} onLoadMore={() => setVisibleCount((c) => c + VACANCY_PAGE_SIZE)} />
        </>
      ) : (
      // Master-detail split, not a vertical stack of full cards - a long
      // filtered list used to mean scrolling past six action toolbars to
      // compare two vacancies. The list stays a dense, scannable column;
      // the detail pane (still the exact same header/meta/action-toolbar
      // markup a card used to render inline) shows whichever one is
      // selected, defaulting to the first result. Stacks to one column
      // below the `md` breakpoint, same responsive convention Sidebar.jsx
      // already establishes elsewhere in this app.
      <div className="flex flex-col md:flex-row" style={{ gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
        {/* w-full/md:w-[380px] via className only, deliberately no inline
            `width` alongside it - an inline style always wins over a class
            regardless of breakpoint, which would silently pin this to one
            width at every viewport size (the same lesson Sidebar.jsx's own
            hidden/md:block split already documents). */}
        <div className="w-full md:w-[380px]" style={{ flexShrink: 0 }}>
          <Card
            style={{
              marginBottom: 0, padding: 0, overflow: 'hidden',
              position: 'sticky',
              top: 'calc(var(--navbar-height) + var(--breadcrumb-height) + var(--spacing-md))'
            }}
          >
            <div style={{ maxHeight: 'calc(100vh - var(--navbar-height) - var(--breadcrumb-height) - 220px)', minHeight: 160, overflowY: 'auto' }}>
              {visibleVacancies.map((v, i) => {
                const isSelected = v.id === selectedVacancy?.id;
                const overdue = isOverdue(v);
                const deadlineInfo = v.deadline && !overdue ? daysLeftLabel(v.deadline) : null;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVacancyId(v.id)}
                    className="list-row"
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
                      border: 'none', borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                      cursor: 'pointer', font: 'inherit',
                      // Only set inline when selected - leaving it unset
                      // otherwise lets the .list-row:hover rule in
                      // theme.css show through (an inline `background`,
                      // even 'transparent', always wins over a CSS class).
                      ...(isSelected
                        ? { background: 'var(--color-primary-light)', boxShadow: 'inset 3px 0 0 0 var(--color-primary)' }
                        : {})
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 600, color: 'var(--color-text)', minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                      }}>
                        {v.title}
                      </div>
                      <StatusBadge status={v.status} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.department?.name} &middot; {v.postingType}
                      {overdue && <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}> &middot; overdue</span>}
                      {deadlineInfo && (
                        <span style={{ color: deadlineInfo.urgent ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: deadlineInfo.urgent ? 600 : 400 }}>
                          {' '}&middot; {deadlineInfo.text}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                      {v._count?.applications ?? 0} application{v._count?.applications === 1 ? '' : 's'}
                    </div>
                  </button>
                );
              })}
            </div>
            {sortedVacancies.length > visibleCount && (
              <div style={{ padding: 10, borderTop: '1px solid var(--color-border)' }}>
                <Button variant="ghost" style={{ width: '100%' }} onClick={() => setVisibleCount((c) => c + VACANCY_PAGE_SIZE)}>
                  Load more ({sortedVacancies.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedVacancy && (() => {
            const v = selectedVacancy;
            return (
              <Card accent={isOverdue(v) ? 'var(--color-danger)' : undefined} style={{ marginBottom: 0 }}>
                {/* Header: title reads as the actual heading (was buried mid-
                    sentence after the jobRef); status + application count form
                    a right-aligned cluster instead of running into the title
                    line, so both are scannable at a glance. */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {v.title}
                      {/* Outlined, not filled - a first-class attribute (Internal/
                          External is a hard eligibility gate elsewhere) but
                          shouldn't compete visually with the colored Status/
                          Readvertised/urgency badges next to it. */}
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 999,
                        border: '1px solid var(--color-border)', color: 'var(--color-text-muted)'
                      }}>
                        {v.postingType}
                      </span>
                      {v.readvertisedFromId != null && <StatusBadge status="Readvertised" />}
                      {v.status === 'PendingApproval' && <UrgencyBadge followUp={followUps.find((f) => f.taskType === 'VacancyApproval' && f.taskId === v.id)} />}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {v.jobRef}
                      {' '}&middot; {v.department?.directorate?.name} &mdash; {v.department?.name}
                      {v.reportsToPosition && <> &middot; Reports to {v.reportsToPosition.name}</>}
                      {v.createdBy?.name && <> &middot; Created by {v.createdBy.name}</>}
                      {v.deadline && (
                        <span style={{ fontWeight: isOverdue(v) ? 600 : 400, color: isOverdue(v) ? 'var(--color-danger)' : 'inherit' }}>
                          {' '}&middot; {isOverdue(v) ? 'Deadline passed' : 'Deadline'} {new Date(v.deadline).toLocaleDateString()}
                          {!isOverdue(v) && (() => {
                            const { text, urgent } = daysLeftLabel(v.deadline);
                            return (
                              <span style={{ color: urgent ? 'var(--color-warning)' : 'var(--color-text-muted)', fontWeight: urgent ? 600 : 400 }}>
                                {' '}({text})
                              </span>
                            );
                          })()}
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
                    spacing, separated from the header by a rule. */}
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
                    <Button variant="secondary" style={{ padding: '4px 10px' }} disabled={rowActionBusy != null}
                      loading={rowActionBusy === 'approve'} loadingText="Approving..." onClick={() => approve(v.id)}>Approve</Button>
                  )}
                  {v.status === 'Closed' && canApprove && (
                    <Button variant="secondary" style={{ padding: '4px 10px' }} disabled={rowActionBusy != null}
                      loading={rowActionBusy === 'approve'} loadingText="Re-opening..." onClick={() => approve(v.id)}>Re-open</Button>
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
                    <Button variant="ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)' }} disabled={rowActionBusy != null}
                      loading={rowActionBusy === 'close'} loadingText="Closing..." onClick={() => closeVacancy(v.id)}>Close vacancy</Button>
                  )}
                </div>
              </Card>
            );
          })()}
        </div>
      </div>
      )}

      {editModal && (
        <Modal
          title={`Edit vacancy — ${editModal.jobRef}`}
          onClose={() => setEditModal(null)}
          maxWidth={640}
          footer={<>
            <Button variant="ghost" disabled={savingEdit} onClick={() => setEditModal(null)}>Cancel</Button>
            <Button variant="secondary" disabled={savingEdit} onClick={previewEditForm}>Preview advert</Button>
            <Button loading={savingEdit} loadingText="Saving..." onClick={saveEdit}>Save changes</Button>
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
            <Button variant="ghost" disabled={readvertising} onClick={() => setReadvertiseModal(null)}>Cancel</Button>
            <Button variant="secondary" disabled={readvertising} onClick={previewReadvertiseForm}>Preview advert</Button>
            <Button loading={readvertising} loadingText="Publishing..." onClick={submitReadvertise}>Publish for approval</Button>
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
            <Button variant="ghost" disabled={transitioning} onClick={() => setTransitionModal(null)}>Cancel</Button>
            <Button loading={transitioning} loadingText="Transitioning..." onClick={confirmTransition}>Transition to {transitionModal.target}</Button>
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

          {activeSection === 'interviews' && (() => {
            const interviewApps = crossApps ? crossApps.filter((app) => app.interviewRounds?.length > 0) : null;
            const latestRound = (app) => [...app.interviewRounds].sort((a, b) => b.roundNumber - a.roundNumber)[0];
            const visibleInterviewApps = interviewApps ? interviewApps.slice(0, interviewsVisibleCount) : [];
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <h3 style={{ margin: 0 }}>Interviews</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <LiveIndicator connected={connected} />
                    {interviewApps?.length > 0 && <ViewSwitcher view={view} onChange={setView} />}
                  </div>
                </div>
                <StatsStrip stats={interviewStats} />
                {crossLoading && <CrossQueueRowSkeleton />}
                {interviewApps?.length === 0 && <p>No interviews scheduled yet.</p>}
                {interviewApps?.length > 0 && view === 'table' && (
                  <>
                    <Card style={{ padding: 0 }}>
                      <DataTable
                        getRowKey={(app) => app.id}
                        rows={visibleInterviewApps}
                        columns={[
                          { key: 'candidate', label: 'Candidate', render: (app) => <span style={{ fontWeight: 600 }}>{app.candidate.fullName}</span> },
                          { key: 'vacancy', label: 'Vacancy', render: (app) => `${app.vacancy.jobRef} — ${app.vacancy.title}` },
                          { key: 'round', label: 'Round', render: (app) => `Round ${latestRound(app).roundNumber}` },
                          { key: 'date', label: 'Date', render: (app) => latestRound(app).scheduledDate ? new Date(latestRound(app).scheduledDate).toLocaleDateString() : 'unscheduled' },
                          { key: 'score', label: 'Score', render: (app) => latestRound(app).score != null ? latestRound(app).score.toFixed(1) : '—' },
                          { key: 'recommendation', label: 'Recommendation', render: (app) => latestRound(app).recommendation ? <StatusBadge status={latestRound(app).recommendation} /> : '—' },
                          { key: 'actions', label: '', render: (app) => <Link to={`/hr/applications?vacancyId=${app.vacancy.id}`} style={{ fontSize: 12 }}>Manage &rarr;</Link> }
                        ]}
                      />
                    </Card>
                    <LoadMoreControl total={interviewApps.length} visibleCount={interviewsVisibleCount} onLoadMore={() => setInterviewsVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
                {interviewApps?.length > 0 && view === 'board' && (
                  <>
                    <BoardView
                      getItemKey={(app) => app.id}
                      items={visibleInterviewApps}
                      groupBy={(app) => latestRound(app).recommendation || 'Pending'}
                      columns={[
                        { key: 'Pending', label: 'Pending', color: 'var(--color-text-muted)' },
                        { key: 'Shortlist', label: 'Shortlist', color: STATUS_COLORS.Shortlist },
                        { key: 'Hold', label: 'Hold', color: STATUS_COLORS.Hold },
                        { key: 'Reject', label: 'Reject', color: STATUS_COLORS.Reject }
                      ]}
                      renderCard={(app) => {
                        const r = latestRound(app);
                        return (
                          <Card onClick={() => navigate(`/hr/applications?vacancyId=${app.vacancy.id}`)} style={{ marginBottom: 0, padding: 10 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{app.candidate.fullName}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{app.vacancy.jobRef} &middot; {app.vacancy.title}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                              Round {r.roundNumber}{r.score != null && <> &middot; {r.score.toFixed(1)}</>}
                            </div>
                          </Card>
                        );
                      }}
                    />
                    <LoadMoreControl total={interviewApps.length} visibleCount={interviewsVisibleCount} onLoadMore={() => setInterviewsVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
                {interviewApps?.length > 0 && view !== 'table' && view !== 'board' && (
                  <>
                    {visibleInterviewApps.map((app) => (
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
                    <LoadMoreControl total={interviewApps.length} visibleCount={interviewsVisibleCount} onLoadMore={() => setInterviewsVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
              </div>
            );
          })()}

          {activeSection === 'offers' && (() => {
            const offerApps = crossApps ? crossApps.filter((app) => app.offer) : null;
            const visibleOfferApps = offerApps ? offerApps.slice(0, offersVisibleCount) : [];
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <h3 style={{ margin: 0 }}>Offers</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <LiveIndicator connected={connected} />
                    {offerApps?.length > 0 && <ViewSwitcher view={view} onChange={setView} />}
                  </div>
                </div>
                <StatsStrip stats={offerStats} />
                {crossLoading && <CrossQueueRowSkeleton />}
                {offerApps?.length === 0 && <p>No offers recommended yet.</p>}
                {offerApps?.length > 0 && view === 'table' && (
                  <>
                    <Card style={{ padding: 0 }}>
                      <DataTable
                        getRowKey={(app) => app.id}
                        rows={visibleOfferApps}
                        columns={[
                          { key: 'candidate', label: 'Candidate', render: (app) => <span style={{ fontWeight: 600 }}>{app.candidate.fullName}</span> },
                          { key: 'vacancy', label: 'Vacancy', render: (app) => `${app.vacancy.jobRef} — ${app.vacancy.title}` },
                          { key: 'status', label: 'Offer status', render: (app) => <StatusBadge status={app.offer.status} /> },
                          { key: 'actions', label: '', render: (app) => <Link to={`/hr/applications?vacancyId=${app.vacancy.id}`} style={{ fontSize: 12 }}>Manage &rarr;</Link> }
                        ]}
                      />
                    </Card>
                    <LoadMoreControl total={offerApps.length} visibleCount={offersVisibleCount} onLoadMore={() => setOffersVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
                {offerApps?.length > 0 && view === 'board' && (
                  <>
                    <BoardView
                      getItemKey={(app) => app.id}
                      items={visibleOfferApps}
                      groupBy={(app) => app.offer.status}
                      columns={[
                        { key: 'Recommended', label: 'Recommended', color: STATUS_COLORS.Recommended },
                        { key: 'Approved', label: 'Approved', color: STATUS_COLORS.Approved },
                        { key: 'Extended', label: 'Extended', color: STATUS_COLORS.Extended },
                        { key: 'Accepted', label: 'Accepted', color: STATUS_COLORS.Accepted },
                        { key: 'Declined', label: 'Declined', color: STATUS_COLORS.Declined }
                      ]}
                      renderCard={(app) => (
                        <Card onClick={() => navigate(`/hr/applications?vacancyId=${app.vacancy.id}`)} style={{ marginBottom: 0, padding: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{app.candidate.fullName}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{app.vacancy.jobRef} &middot; {app.vacancy.title}</div>
                        </Card>
                      )}
                    />
                    <LoadMoreControl total={offerApps.length} visibleCount={offersVisibleCount} onLoadMore={() => setOffersVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
                {offerApps?.length > 0 && view !== 'table' && view !== 'board' && (
                  <>
                    {visibleOfferApps.map((app) => (
                      <Card key={app.id}>
                        <strong>{app.candidate.fullName}</strong> &mdash; {app.vacancy.jobRef} ({app.vacancy.title})
                        {' '}&middot; Offer: <StatusBadge status={app.offer.status} />
                        <div style={{ marginTop: 6 }}>
                          <Link to={`/hr/applications?vacancyId=${app.vacancy.id}`}>Manage in Application Management &rarr;</Link>
                        </div>
                      </Card>
                    ))}
                    <LoadMoreControl total={offerApps.length} visibleCount={offersVisibleCount} onLoadMore={() => setOffersVisibleCount((c) => c + CROSS_PAGE_SIZE)} />
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
