import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, AlertTriangle, RotateCw } from 'lucide-react';
import client from '../models/apiClient';
import Button from '../components/Button';
import Card from '../components/Card';
import Skeleton from '../components/Skeleton';
import VacancyAdvert from '../components/VacancyAdvert';
import VacancyAdvertPrintLayout from '../components/VacancyAdvertPrintLayout';
import { downloadElementAsPdf, sanitizeFilenamePart } from '../utils/downloadElementAsPdf';

// Public, unauthenticated job-details page - the "read the advert before
// committing to an account" step Home.jsx's cards previously had no way to
// offer (only "Apply Now", which bounces a guest straight to /login). Uses
// the same GET /api/vacancies/:id ApplyForm.jsx already calls unauth'd, and
// the same VacancyAdvert/VacancyAdvertPrintLayout components the apply
// wizard's JobDetailsStep.jsx renders - one advert layout, not a second
// one to keep in sync. Registered as a normal PaddedLayout route (App.jsx),
// not full-bleed - this is ordinary page content, not a hero.
export default function JobDetails() {
  const { id } = useParams();
  const [vacancy, setVacancy] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const printRef = useRef(null);

  const load = () => {
    setNotFound(false);
    setLoadError(false);
    setVacancy(null);
    client.get(`/api/vacancies/${id}`)
      .then((res) => setVacancy(res.data))
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true);
        else setLoadError(true);
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [id]);

  const deadlinePassed = vacancy?.deadline && new Date(vacancy.deadline) < new Date();
  const departmentLabel = vacancy?.department?.name
    ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
    : null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const filename = `${sanitizeFilenamePart(vacancy.jobRef) || 'vacancy'}-job-details.pdf`;
      const adTypeLabel = vacancy.postingType === 'Internal' ? 'Internal Job Advertisement' : 'External Job Advertisement';
      await downloadElementAsPdf(printRef.current, filename, { footerLeft: `${adTypeLabel}- ${vacancy.title || ''}` });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <Link to="/#open-positions" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
        <ArrowLeft size={15} /> Back to Open Positions
      </Link>

      {!vacancy && !notFound && !loadError && (
        <Card>
          <Skeleton width={280} height={24} style={{ marginBottom: 12 }} />
          <Skeleton width={360} height={14} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={80} style={{ marginBottom: 16 }} />
          <Skeleton width="100%" height={120} />
        </Card>
      )}

      {notFound && (
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <AlertTriangle size={28} color="var(--color-warning)" style={{ marginBottom: 10 }} />
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
            This vacancy doesn&rsquo;t exist, or is no longer available.
          </p>
          <Link to="/#open-positions"><Button variant="secondary">View open positions</Button></Link>
        </Card>
      )}

      {loadError && (
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <AlertTriangle size={28} color="var(--color-warning)" style={{ marginBottom: 10 }} />
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 16 }}>
            We couldn&rsquo;t load this vacancy right now. Please check your connection and try again.
          </p>
          <Button variant="secondary" onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <RotateCw size={15} /> Retry
          </Button>
        </Card>
      )}

      {vacancy && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button type="button" variant="secondary" onClick={handleDownload} disabled={downloading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Download size={15} /> {downloading ? 'Preparing PDF...' : 'Download as PDF'}
            </Button>
          </div>

          <VacancyAdvert
            jobRef={vacancy.jobRef}
            title={vacancy.title}
            departmentLabel={departmentLabel}
            reportsToName={vacancy.reportsToPosition?.name}
            salaryScale={vacancy.salaryScale}
            positionsRequired={vacancy.positionsRequired}
            deadline={vacancy.deadline}
            readvertised={vacancy.readvertisedFromId != null}
            location={vacancy.location}
            employmentCategory={vacancy.employmentCategory}
            jobPurpose={vacancy.jobPurpose}
            essentialRequirements={vacancy.essentialRequirements}
            minimumEducationLevel={vacancy.minimumEducationLevel}
            minimumExperienceYears={vacancy.minimumExperienceYears}
            preferredFieldOfStudy={vacancy.preferredFieldOfStudy}
            minimumAge={vacancy.minimumAge}
            maximumAge={vacancy.maximumAge}
            minimumFlyingHours={vacancy.minimumFlyingHours}
            minimumCGPA={vacancy.minimumCGPA}
            requiredExamGrades={vacancy.requiredExamGrades}
            desirableRequirements={vacancy.desirableRequirements}
            generalKnowledge={vacancy.generalKnowledge}
            specialSkills={vacancy.specialSkills}
          />

          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
            {deadlinePassed ? (
              <Button variant="secondary" disabled style={{ width: '100%' }}>This vacancy is closed</Button>
            ) : (
              // /apply/:id is RequireCandidate-gated (App.jsx) - an
              // anonymous visitor is bounced to /login?returnTo=... and
              // lands back here after signing in, same as every other
              // Apply link in the app.
              <Link to={`/apply/${vacancy.id}`} style={{ textDecoration: 'none' }}>
                <Button style={{ width: '100%' }}>Apply Now</Button>
              </Link>
            )}
          </div>

          {/* Off-screen (not display:none - html2canvas needs it actually
              laid out) - same pattern as JobDetailsStep.jsx/useVacancyPdfDownload. */}
          <div style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1 }} aria-hidden="true">
            <div ref={printRef}>
              <VacancyAdvertPrintLayout
                jobRef={vacancy.jobRef}
                title={vacancy.title}
                reportsToName={vacancy.reportsToPosition?.name}
                salaryScale={vacancy.salaryScale}
                positionsRequired={vacancy.positionsRequired}
                deadline={vacancy.deadline}
                jobPurpose={vacancy.jobPurpose}
                essentialRequirements={vacancy.essentialRequirements}
                minimumEducationLevel={vacancy.minimumEducationLevel}
                minimumExperienceYears={vacancy.minimumExperienceYears}
                preferredFieldOfStudy={vacancy.preferredFieldOfStudy}
                desirableRequirements={vacancy.desirableRequirements}
                generalKnowledge={vacancy.generalKnowledge}
                specialSkills={vacancy.specialSkills}
              />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
