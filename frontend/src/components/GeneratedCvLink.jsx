import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import GeneratedCvPrintLayout from './GeneratedCvPrintLayout';
import { downloadElementAsPdf, sanitizeFilenamePart } from '../utils/downloadElementAsPdf';

// The CV the system generates from a candidate's profile and application,
// opened like any uploaded document (DocumentPreview's viewer): shown on the
// page, with a Download button that saves it as a PDF. Next to the
// candidate's own uploaded CV wherever their details are shown.
// candidate: the profile (education, work experience, ...); application:
// referees and answers, when there is one.
function GeneratedCvViewer({ candidate, application, vacancyTitle, vacancyJobRef, onClose }) {
  const pageRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const title = `Generated CV - ${candidate?.fullName || 'candidate'}`;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const download = async () => {
    setBusy(true);
    try {
      await downloadElementAsPdf(pageRef.current, `${sanitizeFilenamePart(candidate?.fullName) || 'candidate'}-generated-cv.pdf`,
        { footerLeft: title });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-overlay doc-viewer-overlay" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="doc-viewer-h">
          <h2 title={title}>{title}</h2>
          <div className="doc-viewer-actions">
            <button type="button" className="doc-viewer-btn" onClick={download} disabled={busy}>
              <Download size={15} /> <span>{busy ? 'Preparing...' : 'Download'}</span>
            </button>
            <button type="button" className="ws-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="doc-viewer-b">
          <div className="doc-viewer-image">
            <div style={{ boxShadow: '0 2px 10px rgba(0, 0, 0, .15)', background: '#fff', padding: 40 }}>
              <div ref={pageRef}>
                <GeneratedCvPrintLayout candidate={candidate} application={application} vacancyTitle={vacancyTitle} vacancyJobRef={vacancyJobRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function GeneratedCvLink({ candidate, application, vacancyTitle, vacancyJobRef, children, className, style }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!candidate) return null;
  return (
    <>
      <button type="button" className={['doc-link', className].filter(Boolean).join(' ')} style={style}
        title={`View the CV generated for ${candidate.fullName || 'this candidate'}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        {children || 'Generated CV'}
      </button>
      {open && (
        <GeneratedCvViewer candidate={candidate} application={application} vacancyTitle={vacancyTitle} vacancyJobRef={vacancyJobRef} onClose={close} />
      )}
    </>
  );
}

// The candidate's own uploaded CV (an application document of kind CV),
// or null.
export function uploadedCv(documents) {
  return (documents || []).find((d) => d.category === 'CV') || null;
}
