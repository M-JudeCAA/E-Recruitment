import { useRef, useState } from 'react';
import VacancyAdvertPrintLayout from '../components/VacancyAdvertPrintLayout';
import { downloadElementAsPdf, sanitizeFilenamePart } from './downloadElementAsPdf';

// Same PDF download the apply wizard's Job Details step uses ("Download as
// PDF" - JobDetailsStep.jsx: VacancyAdvertPrintLayout captured by
// html2canvas, paginated into a real .pdf by downloadElementAsPdf), shared
// here so every "Download job details"/"Download a Copy" button across the
// job listing surfaces (Home.jsx, CandidateJobs.jsx, CandidateHome.jsx)
// produces the exact same file instead of each maintaining its own
// look-alike.
//
// JobDetailsStep.jsx renders its print layout permanently (off-screen) for
// a single, already-known vacancy, so its ref is always ready by the time
// the button is clickable. A job listing shows many vacancies at once and
// can't afford to keep one hidden VacancyAdvertPrintLayout mounted per
// card, so this hook mounts ONE hidden layout on demand for whichever
// vacancy was just clicked, waits two animation frames for the browser to
// actually lay it out (mounting alone isn't enough - html2canvas needs a
// real layout pass, and a single frame is not reliably enough of one),
// captures it, then unmounts it again.
export function useVacancyPdfDownload() {
  const printRef = useRef(null);
  const [target, setTarget] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const download = (vacancy) => new Promise((resolve) => {
    setTarget(vacancy);
    setDownloadingId(vacancy.id);
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        const adTypeLabel = vacancy.postingType === 'Internal' ? 'Internal Job Advertisement' : 'External Job Advertisement';
        const filename = `${sanitizeFilenamePart(vacancy.jobRef) || 'vacancy'}-job-details.pdf`;
        try {
          await downloadElementAsPdf(printRef.current, filename, {
            footerLeft: `${adTypeLabel}- ${vacancy.title || ''}`
          });
        } finally {
          setDownloadingId(null);
          setTarget(null);
          resolve();
        }
      });
    });
  });

  const hiddenPrintArea = target && (
    <div style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1 }} aria-hidden="true">
      <div ref={printRef}>
        <VacancyAdvertPrintLayout
          jobRef={target.jobRef}
          title={target.title}
          reportsToName={target.reportsToPosition?.name}
          salaryScale={target.salaryScale}
          positionsRequired={target.positionsRequired}
          deadline={target.deadline}
          jobPurpose={target.jobPurpose}
          essentialRequirements={target.essentialRequirements}
          minimumEducationLevel={target.minimumEducationLevel}
          minimumExperienceYears={target.minimumExperienceYears}
          preferredFieldOfStudy={target.preferredFieldOfStudy}
          desirableRequirements={target.desirableRequirements}
          generalKnowledge={target.generalKnowledge}
          specialSkills={target.specialSkills}
        />
      </div>
    </div>
  );

  return { download, hiddenPrintArea, downloadingId };
}
