import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import VacancyAdvert from '../../components/VacancyAdvert';
import VacancyAdvertPrintLayout from '../../components/VacancyAdvertPrintLayout';
import Button from '../../components/Button';
import { downloadElementAsPdf, sanitizeFilenamePart } from '../../utils/downloadElementAsPdf';

// The full vacancy write-up in UCAA's standard advert layout. Its own
// dedicated first step rather than a block pinned above every other step,
// so the actual form (Profile, Documents, Questions...) isn't crowded by
// a job posting the candidate has already read by the time they're
// filling anything in.
export default function JobDetailsStep({ vacancy }) {
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const advertProps = {
    jobRef: vacancy.jobRef,
    title: vacancy.title,
    reportsToName: vacancy.reportsToPosition?.name,
    salaryScale: vacancy.salaryScale,
    positionsRequired: vacancy.positionsRequired,
    deadline: vacancy.deadline,
    postingType: vacancy.postingType,
    jobPurpose: vacancy.jobPurpose,
    essentialRequirements: vacancy.essentialRequirements,
    minimumEducationLevel: vacancy.minimumEducationLevel,
    minimumExperienceYears: vacancy.minimumExperienceYears,
    preferredFieldOfStudy: vacancy.preferredFieldOfStudy,
    desirableRequirements: vacancy.desirableRequirements,
    generalKnowledge: vacancy.generalKnowledge,
    specialSkills: vacancy.specialSkills
  };

  // Matches VacancyAdvertPrintLayout's own adTypeLabel computation - kept
  // as a one-line duplicate here rather than threading it back out of
  // that component, since the running footer is drawn by jsPDF directly
  // (see downloadElementAsPdf.js's drawFooter) and has no other reason to
  // depend on that component's internals.
  const adTypeLabel = vacancy.postingType === 'Internal' ? 'Internal Job Advertisement' : 'External Job Advertisement';

  // Captures VacancyAdvertPrintLayout - a layout purpose-built to match
  // UCAA's actual printed advert (letterhead, colon-style facts,
  // PERSON SPECIFICATIONS table, HOW TO APPLY) - not the on-screen
  // VacancyAdvert below, which is styled for readability inside this
  // wizard's own theme rather than to resemble a printed document.
  const handleDownload = async () => {
    setError(''); setDownloading(true);
    try {
      const filename = `${sanitizeFilenamePart(vacancy.jobRef) || 'vacancy'}-job-details.pdf`;
      await downloadElementAsPdf(printRef.current, filename, {
        footerLeft: `${adTypeLabel}- ${vacancy.title || ''}`
      });
    } catch {
      setError('Could not generate the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="button" variant="secondary" onClick={handleDownload} disabled={downloading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={15} /> {downloading ? 'Preparing PDF...' : 'Download as PDF'}
        </Button>
      </div>
      {error && <p style={{ fontSize: 13, color: 'var(--color-danger)', textAlign: 'right', marginTop: 0 }}>{error}</p>}

      <VacancyAdvert
        jobRef={advertProps.jobRef}
        title={advertProps.title}
        departmentLabel={vacancy.department?.name
          ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
          : null}
        reportsToName={advertProps.reportsToName}
        salaryScale={advertProps.salaryScale}
        positionsRequired={advertProps.positionsRequired}
        deadline={advertProps.deadline}
        jobPurpose={advertProps.jobPurpose}
        essentialRequirements={advertProps.essentialRequirements}
        minimumEducationLevel={advertProps.minimumEducationLevel}
        minimumExperienceYears={advertProps.minimumExperienceYears}
        preferredFieldOfStudy={advertProps.preferredFieldOfStudy}
        desirableRequirements={advertProps.desirableRequirements}
        generalKnowledge={advertProps.generalKnowledge}
        specialSkills={advertProps.specialSkills}
      />

      {/* Off-screen (not display:none - html2canvas needs it actually
          laid out) - rendered permanently so it's ready to capture the
          instant the button is clicked, but never visible to the candidate. */}
      <div style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1 }} aria-hidden="true">
        <div ref={printRef}>
          <VacancyAdvertPrintLayout {...advertProps} />
        </div>
      </div>
    </div>
  );
}
