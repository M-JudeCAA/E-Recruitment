import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Select from '../components/Select';
import TextField from '../components/TextField';
import ApplicationReviewCard from '../components/ApplicationReviewCard';
import { useGeneratedCvDownload } from '../utils/useGeneratedCvDownload';
import { safeJsonParse } from '../utils/safeJsonParse';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// ApplicationStatus minus Draft - HR never filters to a candidate's
// unsubmitted draft.
const STATUS_OPTIONS = [
  'Submitted', 'UnderReview', 'Shortlisted', 'InterviewScheduled',
  'Interviewed', 'Offered', 'Rejected', 'Withdrawn'
];
const QUEUE_PAGE_SIZE = 20;

// HR's single home for working applications end-to-end - was previously
// split across a thin, N+1-fetched "Applications" tab on HRDashboard (list
// only, no actions) and VacancyDetail.jsx (every real action, but scoped to
// one vacancy at a time). Two modes, switched by the vacancyId URL param so
// links from VacancyDetail/HRDashboard can deep-link straight into either:
//
//   - No vacancy selected: the true cross-vacancy queue - server-side
//     filtered/paginated via GET /api/applications.
//   - A vacancy selected: everything VacancyDetail.jsx used to render for
//     that one vacancy (begin review, drag-to-rank shortlist, the full
//     application list) - unpaginated, reusing the existing
//     /api/vacancies/:id/applications endpoint, since shortlist ranking
//     needs the whole unranked pool together, not a page of it.
export default function ApplicationManagement() {
  const { staff } = useAuth();
  const canBeginReview = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;

  const [searchParams, setSearchParams] = useSearchParams();
  const vacancyId = searchParams.get('vacancyId') || '';
  const selectVacancy = (id) => setSearchParams(id ? { vacancyId: id } : {});

  const [vacancyOptions, setVacancyOptions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState('');
  const [candidateTypeFilter, setCandidateTypeFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [screeningFilter, setScreeningFilter] = useState('all'); // all|flagged|passed
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // setPage(1) alongside every filter change so a narrowed filter never
  // leaves the queue stranded on a page past the new, smaller result set.
  const applyStatusFilter = (v) => { setStatusFilter(v); setPage(1); };
  const applyCandidateTypeFilter = (v) => { setCandidateTypeFilter(v); setPage(1); };
  const applyDepartmentFilter = (v) => { setDepartmentFilter(v); setPage(1); };
  const applyScreeningFilter = (v) => { setScreeningFilter(v); setPage(1); };

  // No separate Search button - typing runs the search automatically, same
  // as every other filter. Debounced so a full query doesn't fire on every
  // keystroke, unlike the select filters which have no such concern.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // --- Mode B: single-vacancy state (ports VacancyDetail.jsx's own) ---
  const [vacancy, setVacancy] = useState(null);
  const [vacancyApps, setVacancyApps] = useState([]);
  const [shortlistOrder, setShortlistOrder] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);

  // --- Mode A: cross-vacancy queue state ---
  const [queue, setQueue] = useState(null); // { data, total, page, limit }
  const [queueLoading, setQueueLoading] = useState(false);

  const { download: downloadGeneratedCv, hiddenPrintArea, downloadingId } = useGeneratedCvDownload();

  useEffect(() => {
    staffClient.get('/api/vacancies/admin').then((res) => setVacancyOptions(res.data)).catch(() => {});
    staffClient.get('/api/departments/approved').then((res) => setDepartments(res.data)).catch(() => {});
  }, []);

  // Guards against a stale response overwriting a newer one - e.g. quickly
  // switching the Vacancy filter (or navigating back/forward) can let an
  // older in-flight request for a previous vacancyId resolve after a newer
  // one. Each call captures its own id; a response is only applied if
  // nothing newer has started since.
  const vacancyRequestIdRef = useRef(0);

  const loadVacancyMode = () => {
    const requestId = ++vacancyRequestIdRef.current;
    const currentVacancyId = vacancyId;
    staffClient.get(`/api/vacancies/${currentVacancyId}`)
      .then((res) => { if (vacancyRequestIdRef.current === requestId) setVacancy(res.data); })
      .catch((err) => { if (vacancyRequestIdRef.current === requestId) setError(err.response?.data?.error || 'Could not load this vacancy'); });
    staffClient.get(`/api/vacancies/${currentVacancyId}/applications`)
      .then((res) => {
        if (vacancyRequestIdRef.current !== requestId) return;
        setVacancyApps(res.data);
        const alreadyRanked = res.data
          .filter((a) => a.rank != null)
          .sort((a, b) => a.rank - b.rank)
          .map((a) => a.id);
        // Score-ordered, highest first - adjusts as applications come in;
        // already-ranked applicants keep their committed rank untouched.
        const candidates = res.data
          .filter((a) => a.status === 'UnderReview' && a.rank == null)
          .sort((a, b) => (b.shortlistScore ?? -Infinity) - (a.shortlistScore ?? -Infinity))
          .map((a) => a.id);
        setShortlistOrder([...alreadyRanked, ...candidates]);
      })
      .catch((err) => { if (vacancyRequestIdRef.current === requestId) setError(err.response?.data?.error || 'Could not load this vacancy\'s applications'); });
  };

  useEffect(() => {
    if (vacancyId) {
      setVacancy(null);
      loadVacancyMode();
    } else {
      // These filters are hidden (not stale-but-invisible) once a specific
      // vacancy is selected - reset them so they don't silently carry over
      // and re-apply the moment the vacancy filter is cleared again.
      setDepartmentFilter(''); setCandidateTypeFilter(''); setSearchInput(''); setSearch('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancyId]);

  const loadQueue = () => {
    setQueueLoading(true);
    setError('');
    const params = { page, limit: QUEUE_PAGE_SIZE };
    if (statusFilter) params.status = statusFilter;
    if (candidateTypeFilter) params.candidateType = candidateTypeFilter;
    if (departmentFilter) params.departmentId = departmentFilter;
    if (screeningFilter === 'flagged') params.screeningPassed = 'false';
    if (screeningFilter === 'passed') params.screeningPassed = 'true';
    if (search) params.search = search;
    staffClient.get('/api/applications', { params })
      .then((res) => setQueue(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load applications'))
      .finally(() => setQueueLoading(false));
  };

  useEffect(() => {
    if (!vacancyId) loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancyId, statusFilter, candidateTypeFilter, departmentFilter, screeningFilter, search, page]);

  const moveInOrder = (fromIndex, toIndex) => {
    setShortlistOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const [beginReviewLoading, setBeginReviewLoading] = useState(false);
  const beginReview = async () => {
    setError(''); setBeginReviewLoading(true);
    try {
      await staffClient.patch(`/api/vacancies/${vacancyId}/begin-review`);
      loadVacancyMode();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not begin review');
    } finally {
      setBeginReviewLoading(false);
    }
  };

  const [savingRanking, setSavingRanking] = useState(false);
  const saveRanking = async () => {
    setError(''); setSavingRanking(true);
    // The version of every application this ranking was built from - the
    // backend rejects (409) if any has moved on since (another HR user's
    // ranking write, a shortlist() call, etc.), rather than silently
    // overwriting a decision made after this page was loaded.
    const applicationRankVersions = Object.fromEntries(
      shortlistOrder.map((id) => [id, appsById[id]?.rankVersion ?? 0])
    );
    try {
      await staffClient.post(`/api/vacancies/${vacancyId}/rank`, { applicationIds: shortlistOrder, applicationRankVersions });
      loadVacancyMode();
    } catch (err) {
      setError(
        err.response?.status === 409
          ? 'This ranking changed elsewhere since you loaded it - reloading the current state now.'
          : (err.response?.data?.error || 'Could not save ranking')
      );
      if (err.response?.status === 409) loadVacancyMode();
    } finally {
      setSavingRanking(false);
    }
  };

  const appsById = Object.fromEntries(vacancyApps.map((a) => [a.id, a]));
  const rankedApps = shortlistOrder.map((appId) => appsById[appId]).filter(Boolean);
  const filteredVacancyApps = vacancyApps.filter((app) => {
    if (statusFilter && app.status !== statusFilter) return false;
    if (screeningFilter === 'flagged') return app.screeningPassed === false;
    if (screeningFilter === 'passed') return app.screeningPassed === true;
    return true;
  });

  const totalPages = queue ? Math.max(Math.ceil(queue.total / queue.limit), 1) : 1;

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="applications" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Application Management" subtitle="Review and manage applications across every vacancy" />
        <Alert type="error" message={error} />

        <Card style={{ marginBottom: 'var(--spacing-md)' }}>
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Select label="Vacancy" value={vacancyId} onChange={(e) => selectVacancy(e.target.value)} style={{ flex: '2 1 260px' }}>
              <option value="">All vacancies</option>
              {vacancyOptions.map((v) => <option key={v.id} value={v.id}>{v.jobRef} — {v.title}</option>)}
            </Select>
            <Select label="Status" value={statusFilter} onChange={(e) => applyStatusFilter(e.target.value)} style={{ flex: '1 1 180px' }}>
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select label="Screening" value={screeningFilter} onChange={(e) => applyScreeningFilter(e.target.value)} style={{ flex: '1 1 180px' }}>
              <option value="all">All applications</option>
              <option value="flagged">Flagged only</option>
              <option value="passed">Meets criteria only</option>
            </Select>
            {/* Department/candidate type/search only make sense browsing
                across vacancies - a single vacancy already narrows
                department, and its applicant pool is small enough to
                scan without a text search. */}
            {!vacancyId && (
              <>
                <Select label="Department" value={departmentFilter} onChange={(e) => applyDepartmentFilter(e.target.value)} style={{ flex: '1 1 200px' }}>
                  <option value="">All departments</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
                <Select label="Candidate type" value={candidateTypeFilter} onChange={(e) => applyCandidateTypeFilter(e.target.value)} style={{ flex: '1 1 160px' }}>
                  <option value="">All</option>
                  <option value="Internal">Internal</option>
                  <option value="External">External</option>
                </Select>
                <TextField
                  label="Search"
                  placeholder="Candidate name or email"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  style={{ flex: '2 1 220px' }}
                />
              </>
            )}
          </div>
        </Card>

        {!vacancyId ? (
          <>
            {queueLoading && <p>Loading applications...</p>}
            {queue && queue.data.length === 0 && <p>No applications match these filters.</p>}
            {queue?.data.map((app) => (
              <ApplicationReviewCard
                key={app.id} app={app} vacancy={app.vacancy} staffRole={staff?.role}
                onUpdated={loadQueue} onDownloadCv={downloadGeneratedCv} downloadingId={downloadingId}
                showVacancyContext
              />
            ))}
            {queue && queue.total > queue.limit && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {queue.page} of {totalPages}</span>
                <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </>
        ) : !vacancy ? (
          <p>Loading...</p>
        ) : vacancy.status === 'PendingApproval' ? (
          <Alert type="info" message="This vacancy hasn't been approved and published yet, so there are no applications to review. Approve it from the HR dashboard first." />
        ) : (
          <>
            {canBeginReview && vacancyApps.some((a) => a.status === 'Submitted') && (
              <Card accent="var(--color-warning)">
                <strong>{vacancyApps.filter((a) => a.status === 'Submitted').length}</strong> application(s) awaiting review.
                <Button style={{ marginLeft: 12 }} onClick={beginReview} disabled={beginReviewLoading}>
                  {beginReviewLoading ? 'Screening...' : 'Begin Review'}
                </Button>
              </Card>
            )}

            <h3>Shortlist ranking</h3>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Drag to reorder. The top {vacancy.positionsRequired} become Primary; the rest become Reserve automatically.
            </p>
            {rankedApps.map((app, index) => (
              <Card
                key={app.id}
                accent={index < vacancy.positionsRequired ? 'var(--color-accent)' : 'var(--color-warning)'}
                style={{ cursor: 'grab' }}
              >
                <div
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragIndex !== null) moveInOrder(dragIndex, index); setDragIndex(null); }}
                >
                  #{index + 1} &mdash; {app.candidate.fullName} ({app.candidate.candidateType})
                  {' '}&middot; {index < vacancy.positionsRequired ? 'Primary' : 'Reserve'}
                  {app.shortlistScore != null && (
                    <span title={safeJsonParse(app.shortlistScoreReasons, []).join('; ') || 'No scoring factors applied'}
                      style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 12 }}>
                      &middot; Score: {app.shortlistScore.toFixed(1)}
                    </span>
                  )}
                </div>
              </Card>
            ))}
            {rankedApps.length > 0 && (
              <Button onClick={saveRanking} disabled={savingRanking}>
                {savingRanking ? 'Saving...' : 'Save ranking & shortlist'}
              </Button>
            )}

            <h3 style={{ marginTop: 24 }}>All applications</h3>
            {filteredVacancyApps.map((app) => (
              <ApplicationReviewCard
                key={app.id} app={app} vacancy={vacancy} staffRole={staff?.role}
                onUpdated={loadVacancyMode} onDownloadCv={downloadGeneratedCv} downloadingId={downloadingId}
              />
            ))}
          </>
        )}

        {hiddenPrintArea}
      </div>
    </div>
  );
}
