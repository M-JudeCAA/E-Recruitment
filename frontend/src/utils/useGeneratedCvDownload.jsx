import { useRef, useState } from 'react';
import GeneratedCvPrintLayout from '../components/GeneratedCvPrintLayout';
import { downloadElementAsPdf, sanitizeFilenamePart } from './downloadElementAsPdf';

// Same on-demand hidden-layout-then-capture pattern as
// useVacancyPdfDownload.jsx: a per-vacancy applicant list can have many
// applications, so this mounts ONE hidden GeneratedCvPrintLayout for
// whichever application HR just clicked "Download CV" on, waits for a real
// layout pass, captures it, then unmounts it again - rather than keeping
// one hidden layout permanently mounted per applicant.
export function useGeneratedCvDownload() {
  const printRef = useRef(null);
  const [target, setTarget] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  const download = (application, vacancy) => new Promise((resolve) => {
    setTarget({ application, vacancy });
    setDownloadingId(application.id);
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        const filename = `${sanitizeFilenamePart(application.candidate?.fullName) || 'candidate'}-cv.pdf`;
        try {
          await downloadElementAsPdf(printRef.current, filename, {
            footerLeft: `Generated CV — ${application.candidate?.fullName || ''}`
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
        <GeneratedCvPrintLayout
          candidate={target.application.candidate}
          application={target.application}
          vacancyTitle={target.vacancy?.title}
          vacancyJobRef={target.vacancy?.jobRef}
        />
      </div>
    </div>
  );

  return { download, hiddenPrintArea, downloadingId };
}
