import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import GeneratedCvPrintLayout from '../../components/GeneratedCvPrintLayout';
import Button from '../../components/Button';
import { downloadElementAsPdf, sanitizeFilenamePart } from '../../utils/downloadElementAsPdf';

export default function ReviewStep({
  profile, coverLetter, referees, profileDetails, questions, internalProfile, candidateType, goTo, stepIndexes,
  desirableRequirements, desirableAnswers, disqualifyingRequirements, disqualifyingAnswers, vacancy
}) {
  const WORK_AUTH_LABELS = { Yes: 'Yes', No: 'No', Sponsorship: 'Would need sponsorship' };
  const RELOCATE_LABELS = { Yes: 'Yes', No: 'No', Depends: 'Depends on the offer' };

  // Same reasoning a disqualifying question fails automated screening for
  // (see backend screeningService.screenApplication) - reused here so a
  // candidate sees the same signal HR will, before they submit rather than
  // only after. Never blocks anything; it's advisory, matching how
  // screeningPassed itself is only ever a flag for HR, never a hard gate.
  const disqualifyingMet = (req, answer) => answer === undefined ? null
    : req.answerType === 'number' ? (typeof answer === 'number' && answer >= req.minValue)
      : answer === (req.requiredAnswer !== 'No');

  // Reuses the exact GeneratedCvPrintLayout/downloadElementAsPdf pipeline
  // HR already has (see useGeneratedCvDownload.jsx) - built from the
  // wizard's own current form state rather than a server round-trip, so a
  // candidate can preview it before ever submitting, something previously
  // only HR could do (after the fact, from the submitted application).
  const printRef = useRef(null);
  const [downloadingCv, setDownloadingCv] = useState(false);
  const [cvError, setCvError] = useState('');
  const cvCandidate = { ...profile, ...profileDetails };
  const cvApplication = { ...questions, referees };
  const downloadCv = async () => {
    setCvError(''); setDownloadingCv(true);
    try {
      const filename = `${sanitizeFilenamePart(profile?.fullName) || 'my'}-cv.pdf`;
      await downloadElementAsPdf(printRef.current, filename, {
        footerLeft: `Generated CV — ${profile?.fullName || ''}`
      });
    } catch {
      setCvError('Could not generate the PDF. Please try again.');
    } finally {
      setDownloadingCv(false);
    }
  };

  const sections = [
    {
      i: stepIndexes.profile,
      title: 'Profile',
      rows: [
        ['Location', profileDetails.location || '—'],
        ['National ID (NIN)', profileDetails.nationalId || '—'],
        ['Work authorization', WORK_AUTH_LABELS[profileDetails.workAuthorization] || '—'],
        ['Education entries', (profile?.education || []).length],
        ['Work experience entries', (profile?.workExperience || []).length],
      ],
    },
    {
      i: stepIndexes.documents,
      title: 'Documents',
      rows: [
        ['CV', 'Generated automatically from your profile and application details'],
        ['Cover letter', coverLetter ? coverLetter.name : 'Not attached'],
        ['Portfolio', profileDetails.portfolioUrl || '—'],
      ],
    },
    {
      i: stepIndexes.referees,
      title: 'Referees',
      rows: (referees || []).map((r, i) => [
        `Referee ${i + 1}`, r.name ? `${r.name}${r.relationship ? ` (${r.relationship})` : ''} — ${r.phone || '—'}, ${r.email || '—'}` : '—'
      ]),
    },
    {
      i: stepIndexes.questions,
      title: 'Questions',
      rows: [
        ['Open to relocating', RELOCATE_LABELS[questions.openToRelocate] || '—'],
        ['Desired salary', questions.desiredSalary || '—'],
        ['Earliest start', questions.earliestStartDate || '—'],
        ['Why this role', questions.whyThisRole || '—'],
        ...(disqualifyingRequirements || []).map((req) => {
          const answer = disqualifyingAnswers[req.id];
          const met = disqualifyingMet(req, answer);
          const value = answer === undefined ? '—' : (req.answerType === 'number' ? answer : (answer ? 'Yes' : 'No'));
          return [req.text, value, met === false];
        }),
        ...(desirableRequirements || []).map((req) => [
          req.text, desirableAnswers[req.id] === undefined ? '—'
            : req.answerType === 'number' ? desirableAnswers[req.id] : (desirableAnswers[req.id] ? 'Yes' : 'No')
        ]),
      ],
    },
  ];

  if (candidateType === 'Internal') {
    sections.push({
      i: stepIndexes.internal,
      title: 'Internal Profile',
      rows: [
        ['Employee ID', internalProfile.employeeId || '—'],
        ['Department', internalProfile.department || '—'],
        ['Position', internalProfile.position || '—'],
        ['Supervisor', internalProfile.supervisorName || '—'],
      ],
    });
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        Check each section before sending. You can jump back to fix anything.
      </p>
      {sections.map((section) => (
        <div key={section.title} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 15, color: 'var(--color-text)', fontWeight: 600 }}>{section.title}</span>
            <button onClick={() => goTo(section.i)} style={{ fontSize: 12, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
          </div>
          {section.rows.map(([label, value, warn]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '3px 0' }}>
              {/* Both sides wrap rather than truncate - a long CV filename or
                  portfolio URL (one unbroken "word"), a long free-text answer
                  like "Why this role", and a long desirable-requirement question
                  used as the label here all need to stay fully visible on a
                  review-before-submit step. minWidth: 0 on BOTH flex items is
                  required - flex items default to min-width:auto, which ignores
                  maxWidth/wrapping and forces the row wider instead, exactly the
                  bug this fixes (see DocumentsStep.jsx for the same root cause). */}
              <span style={{ color: 'var(--color-text-muted)', maxWidth: '55%', minWidth: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{label}</span>
              <span style={{ color: warn ? 'var(--color-danger)' : 'var(--color-text)', textAlign: 'right', maxWidth: '45%', minWidth: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                {value || '—'}
                {/* Advisory only, never blocking - matches how screeningPassed
                    itself works (see disqualifyingMet above). The candidate can
                    still submit; this just means they won't be surprised later
                    by why HR flagged it. */}
                {warn && <span style={{ display: 'block', fontSize: 11 }}>May not meet this role's minimum requirement</span>}
              </span>
            </div>
          ))}
          {section.title === 'Documents' && (
            <div style={{ marginTop: 10 }}>
              <Button type="button" variant="secondary" onClick={downloadCv} disabled={downloadingCv}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Download size={14} /> {downloadingCv ? 'Preparing PDF...' : 'Preview / download my CV'}
              </Button>
              {cvError && <p style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{cvError}</p>}
            </div>
          )}
        </div>
      ))}

      {/* Off-screen (not display:none - html2canvas needs it actually laid
          out) - same convention as JobDetailsStep's advert PDF and
          useGeneratedCvDownload.jsx's HR-side hook. */}
      <div style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1 }} aria-hidden="true">
        <div ref={printRef}>
          <GeneratedCvPrintLayout candidate={cvCandidate} application={cvApplication} vacancyTitle={vacancy?.title} vacancyJobRef={vacancy?.jobRef} />
        </div>
      </div>
    </div>
  );
}
