import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, MapPin, Users, Calendar, ChevronLeft, ChevronRight, Download, CheckCircle2, FileEdit } from 'lucide-react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import CandidateSidebar from '../components/CandidateSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import VacancyAdvert from '../components/VacancyAdvert';
import LoadingState from '../components/LoadingState';
import ViewSwitcher from '../components/ViewSwitcher';
import DataTable from '../components/DataTable';
import BoardView from '../components/BoardView';
import { useVacancyPdfDownload } from '../utils/useVacancyPdfDownload';

// A vacancy whose deadline has passed is still shown (never apply-able
// again, but its advert stays worth reading/downloading) rather than
// vanishing from the list - see vacancyController.listPublic's own
// comment for why Vacancy.status is never mutated just because a deadline
// lapsed.
const isClosed = (v) => v.deadline && new Date(v.deadline) < new Date();

const PAGE_SIZE = 6;

// TextField's own wrapper carries a fixed 22px marginBottom (meant for
// stacked vertical forms) that its `style` prop can't reach - it only
// merges into the <input>, not the wrapping <label>. That trailing margin
// was pushing "Find Jobs" below the inputs under align-items:flex-end, so
// this search bar uses its own minimal label+input instead of TextField.
function SearchField({ label, ...props }) {
  return (
    <label style={{ display: 'block', flex: '1 1 220px' }}>
      <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</span>
      <input
        {...props}
        style={{
          display: 'block', width: '100%', padding: '11px 14px',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
          fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)'
        }}
      />
    </label>
  );
}

// Full search/browse/apply surface for open vacancies - split out of
// CandidateHome so Home can be a lean overview (stats + shortcuts) and
// this can be its own "Find Jobs" sidebar stop, reachable from anywhere
// in the dashboard rather than only living on the landing page.
export default function CandidateJobs() {
  const { candidate } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [applications, setApplications] = useState([]);
  const [titleSearch, setTitleSearch] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailsVacancy, setDetailsVacancy] = useState(null);
  const { download, hiddenPrintArea, downloadingId } = useVacancyPdfDownload();
  const [urlParams, setUrlParams] = useSearchParams();
  const [view, setView] = useState(urlParams.get('view') || 'list');
  useEffect(() => {
    const next = new URLSearchParams(urlParams);
    if (view === 'list') next.delete('view'); else next.set('view', view);
    setUrlParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params })
      .then((res) => setVacancies(res.data))
      .finally(() => setLoadingJobs(false));
    // Used to swap "Apply Now" for "Continue Application"/"Already Applied"
    // below - saveDraft/submit on the backend refuse a second (non-Draft)
    // application to the same vacancy (applicationDraftController.saveDraft),
    // so this list should reflect that rather than leading to a 409.
    client.get('/api/candidates/me/applications')
      .then((res) => setApplications(res.data))
      .catch(() => {});
  }, [candidate]);

  const applicationByVacancyId = useMemo(
    () => Object.fromEntries(applications.map((app) => [app.vacancy?.id ?? app.vacancyId, app])),
    [applications]
  );

  const filtered = useMemo(() => {
    const title = titleSearch.trim().toLowerCase();
    const dept = deptSearch.trim().toLowerCase();
    return vacancies.filter((v) =>
      (!title || v.title.toLowerCase().includes(title)) &&
      (!dept || (v.department?.name || '').toLowerCase().includes(dept))
    );
  }, [vacancies, titleSearch, deptSearch]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const runSearch = (e) => {
    e.preventDefault();
    setPage(1);
  };

  // Same PDF download as the apply wizard's "Download as PDF" (see
  // useVacancyPdfDownload.jsx) - used here for both this modal's "Download
  // a Copy" button and each closed job's own card button below, so every
  // "download this vacancy" action in the app produces the identical file.
  const downloadCopy = () => detailsVacancy && download(detailsVacancy);

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <CandidateSidebar active="jobs" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title="Find jobs" subtitle="Search open vacancies and apply." />

          <Card style={{ marginBottom: 'var(--spacing-md)' }}>
            <form onSubmit={runSearch} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <SearchField
                label="Job title"
                placeholder="Search by title"
                value={titleSearch}
                onChange={(e) => { setTitleSearch(e.target.value); setPage(1); }}
              />
              <SearchField
                label="Department"
                placeholder="e.g. ICT"
                value={deptSearch}
                onChange={(e) => { setDeptSearch(e.target.value); setPage(1); }}
              />
              <Button type="submit" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 42 }}>
                <Search size={16} /> Find Jobs
              </Button>
              <span style={{ marginLeft: 'auto' }}>
                <ViewSwitcher view={view} onChange={setView} />
              </span>
            </form>
          </Card>

          {loadingJobs && <LoadingState label="Loading open vacancies..." />}
          {!loadingJobs && filtered.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No open vacancies match your search.</p>
          )}

          {!loadingJobs && filtered.length > 0 && view === 'table' && (
            <Card style={{ padding: 0, marginBottom: 'var(--spacing-md)' }}>
              <DataTable
                getRowKey={(v) => v.id}
                onRowClick={(v) => setDetailsVacancy(v)}
                rows={pageItems}
                columns={[
                  { key: 'title', label: 'Title', render: (v) => <span style={{ fontWeight: 600 }}>{v.title}</span> },
                  { key: 'department', label: 'Department', render: (v) => v.department?.name || '—' },
                  { key: 'type', label: 'Type', render: (v) => v.postingType },
                  { key: 'deadline', label: 'Deadline', render: (v) => v.deadline ? new Date(v.deadline).toLocaleDateString() : '—' },
                  { key: 'status', label: 'Status', render: (v) => isClosed(v) ? <StatusBadge status="Closed" /> : <StatusBadge status={v.status} /> }
                ]}
              />
            </Card>
          )}

          {!loadingJobs && filtered.length > 0 && view === 'board' && (
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <BoardView
                getItemKey={(v) => v.id}
                items={pageItems}
                groupBy={(v) => v.department?.name || 'Other'}
                columns={[...new Set(pageItems.map((v) => v.department?.name || 'Other'))].sort().map((name) => ({ key: name, label: name }))}
                renderCard={(v) => (
                  <Card onClick={() => setDetailsVacancy(v)} style={{ marginBottom: 0, padding: 10 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{v.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{v.postingType}</div>
                    {v.deadline && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>Deadline {new Date(v.deadline).toLocaleDateString()}</div>}
                  </Card>
                )}
              />
            </div>
          )}

          {!loadingJobs && filtered.length > 0 && view !== 'table' && view !== 'board' && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'var(--spacing-md)',
                  marginBottom: 'var(--spacing-md)'
                }}
              >
                {pageItems.map((v) => {
                  const closed = isClosed(v);
                  const existingApp = applicationByVacancyId[v.id];
                  return (
                  <Card
                    key={v.id}
                    onClick={() => setDetailsVacancy(v)}
                    style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                      {v.jobRef ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{v.jobRef}: </span> : null}
                      {v.title}
                      {v.readvertisedFromId != null && <span style={{ marginLeft: 8 }}><StatusBadge status="Readvertised" /></span>}
                      {v.minimumExperienceYears ? (
                        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {' '}({v.minimumExperienceYears} Yrs Exp.)
                        </span>
                      ) : null}
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                      {v.department?.name && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={14} /> {v.department.name}
                          <span style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Users size={14} /> {v.positionsRequired} vacancies
                          </span>
                        </span>
                      )}
                      {v.deadline && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Calendar size={14} /> {new Date(v.deadline).toLocaleDateString()}
                        </span>
                      )}
                      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {closed ? <StatusBadge status="Closed" /> : <StatusBadge status={v.status} />}
                        {existingApp && existingApp.status !== 'Draft' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--color-accent)', fontWeight: 600 }}>
                            <CheckCircle2 size={14} /> You applied
                          </span>
                        )}
                      </span>
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex' }}>
                      {closed ? (
                        <Button
                          variant="secondary"
                          disabled={downloadingId === v.id}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onClick={(e) => { e.stopPropagation(); download(v); }}
                        >
                          <Download size={16} /> {downloadingId === v.id ? 'Preparing PDF...' : 'Download Job Details'}
                        </Button>
                      ) : existingApp && existingApp.status === 'Draft' ? (
                        <Link
                          to={`/apply/${v.id}`}
                          style={{ flex: 1, textDecoration: 'none' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <FileEdit size={16} /> Continue Application
                          </Button>
                        </Link>
                      ) : existingApp ? (
                        <Link
                          to="/dashboard/applications"
                          style={{ flex: 1, textDecoration: 'none' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <CheckCircle2 size={16} /> Already Applied
                          </Button>
                        </Link>
                      ) : (
                        <Link
                          to={`/apply/${v.id}`}
                          style={{ flex: 1, textDecoration: 'none' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button style={{ width: '100%' }}>Apply Now</Button>
                        </Link>
                      )}
                    </div>
                  </Card>
                  );
                })}
              </div>
            </>
          )}

          {!loadingJobs && filtered.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                Showing page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> pages.
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="ghost" style={{ padding: '6px 10px' }}
                  disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft size={16} />
                </Button>
                <Button variant="secondary" style={{ padding: '6px 12px' }} disabled>{currentPage}</Button>
                <Button variant="ghost" style={{ padding: '6px 10px' }}
                  disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {detailsVacancy && (
        <Modal title="Job details" onClose={() => setDetailsVacancy(null)} maxWidth={700}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDetailsVacancy(null)}>Close</Button>
              <Button
                variant="secondary"
                onClick={downloadCopy}
                disabled={downloadingId === detailsVacancy.id}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={16} /> {downloadingId === detailsVacancy.id ? 'Preparing PDF...' : 'Download a Copy'}
              </Button>
              {!isClosed(detailsVacancy) && (() => {
                const existingApp = applicationByVacancyId[detailsVacancy.id];
                if (existingApp && existingApp.status === 'Draft') {
                  return (
                    <Link to={`/apply/${detailsVacancy.id}`} style={{ textDecoration: 'none' }}>
                      <Button style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileEdit size={16} /> Continue Application
                      </Button>
                    </Link>
                  );
                }
                if (existingApp) {
                  return (
                    <Link to="/dashboard/applications" style={{ textDecoration: 'none' }}>
                      <Button variant="secondary" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle2 size={16} /> Already Applied
                      </Button>
                    </Link>
                  );
                }
                return (
                  <Link to={`/apply/${detailsVacancy.id}`} style={{ textDecoration: 'none' }}>
                    <Button>Apply Now</Button>
                  </Link>
                );
              })()}
            </>
          }
        >
          <VacancyAdvert
            jobRef={detailsVacancy.jobRef}
            title={detailsVacancy.title}
            departmentLabel={detailsVacancy.department?.name
              ? `${detailsVacancy.department.name}${detailsVacancy.department.directorate?.name ? ', ' + detailsVacancy.department.directorate.name : ''}`
              : null}
            reportsToName={detailsVacancy.reportsToPosition?.name}
            salaryScale={detailsVacancy.salaryScale}
            positionsRequired={detailsVacancy.positionsRequired}
            deadline={detailsVacancy.deadline}
            jobPurpose={detailsVacancy.jobPurpose}
            essentialRequirements={detailsVacancy.essentialRequirements}
            minimumEducationLevel={detailsVacancy.minimumEducationLevel}
            minimumExperienceYears={detailsVacancy.minimumExperienceYears}
            preferredFieldOfStudy={detailsVacancy.preferredFieldOfStudy}
            desirableRequirements={detailsVacancy.desirableRequirements}
            generalKnowledge={detailsVacancy.generalKnowledge}
            specialSkills={detailsVacancy.specialSkills}
          />
        </Modal>
      )}

      {hiddenPrintArea}
    </div>
  );
}
