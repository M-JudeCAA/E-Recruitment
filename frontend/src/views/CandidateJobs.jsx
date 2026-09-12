import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, MapPin, Users, Calendar, ChevronLeft, ChevronRight, Download } from 'lucide-react';
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
  const [titleSearch, setTitleSearch] = useState('');
  const [deptSearch, setDeptSearch] = useState('');
  const [page, setPage] = useState(1);
  const [detailsVacancy, setDetailsVacancy] = useState(null);

  useEffect(() => {
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params })
      .then((res) => setVacancies(res.data))
      .finally(() => setLoadingJobs(false));
  }, [candidate]);

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

  // Printing the modal in place (the original approach) only captured
  // whatever fit within the modal's own scroll viewport (maxHeight: 85vh,
  // overflowY: auto in Modal.jsx) - overflow clipping applies to a
  // descendant's paint regardless of position:absolute, so anything
  // scrolled out of view was cut off the printed page even though it was
  // fully present in the DOM. Opening the advert's already-rendered HTML
  // (#job-details-print-area's innerHTML - the same sanitized markup
  // VacancyAdvert renders in the modal, see htmlSanitizer.js) in its own
  // unconstrained window sidesteps that entirely: nothing there scrolls or
  // clips, so every section prints/saves regardless of what was visible
  // on screen when the button was clicked.
  const downloadCopy = () => {
    if (!detailsVacancy) return;
    const printArea = document.getElementById('job-details-print-area');
    if (!printArea) return;

    const title = detailsVacancy.jobRef
      ? `${detailsVacancy.jobRef} - ${detailsVacancy.title}`
      : detailsVacancy.title;
    const escapedTitle = String(title).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

    const copyWindow = window.open('', '_blank', 'width=900,height=700');
    if (!copyWindow) return; // popup blocked - nothing else to fall back to here
    copyWindow.document.open();
    copyWindow.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapedTitle}</title>
<style>
  /* font-size mirrors theme.css's --font-size-base - this popup is a
     standalone document with no access to that CSS variable, and without
     a matching base size here, em-relative sizing (e.g. h4's default)
     would render at a different size than the modal it was copied from. */
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 15px; color: #14181C; padding: 32px; max-width: 800px; margin: 0 auto; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { border: 1px solid #C9DCE8; padding: 6px 10px; text-align: left; vertical-align: top; }
  ul, ol { padding-left: 1.5em; }
</style>
</head>
<body>${printArea.innerHTML}</body>
</html>`);
    copyWindow.document.close();

    // document.write's onload timing is inconsistent across browsers, so a
    // short timeout is more reliable here than window.onload.
    setTimeout(() => {
      copyWindow.focus();
      copyWindow.print();
    }, 300);
  };

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
            </form>
          </Card>

          {loadingJobs && <LoadingState label="Loading open vacancies..." />}
          {!loadingJobs && filtered.length === 0 && (
            <p style={{ color: 'var(--color-text-muted)' }}>No open vacancies match your search.</p>
          )}

          {!loadingJobs && filtered.length > 0 && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'var(--spacing-md)',
                  marginBottom: 'var(--spacing-md)'
                }}
              >
                {pageItems.map((v) => (
                  <Card
                    key={v.id}
                    onClick={() => setDetailsVacancy(v)}
                    style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                      {v.jobRef ? <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{v.jobRef}: </span> : null}
                      {v.title}
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
                      <span><StatusBadge status={v.status} /></span>
                    </div>

                    <div style={{ marginTop: 'auto', display: 'flex' }}>
                      <Link
                        to={`/apply/${v.id}`}
                        style={{ flex: 1, textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button style={{ width: '100%' }}>Apply Now</Button>
                      </Link>
                    </div>
                  </Card>
                ))}
              </div>

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
            </>
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
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={16} /> Download a Copy
              </Button>
              <Link to={`/apply/${detailsVacancy.id}`} style={{ textDecoration: 'none' }}>
                <Button>Apply Now</Button>
              </Link>
            </>
          }
        >
          {/* id is a DOM handle for downloadCopy() to read the fully-rendered
              markup from, independent of the modal's own scroll state. */}
          <div id="job-details-print-area">
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
          </div>
        </Modal>
      )}
    </div>
  );
}
