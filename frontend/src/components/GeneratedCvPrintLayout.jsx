import React from 'react';

// A CV generated on demand for HR, straight from the same structured data
// the candidate entered across the apply wizard (Profile step's education/
// work experience/exam grades/certificates, the Questions step, the
// Referees step) - there is no candidate-uploaded CV file to fall back on
// (see the Documents step's own note). Only ever rendered off-screen and
// captured by html2canvas, same convention as VacancyAdvertPrintLayout -
// see useGeneratedCvDownload.jsx.
const BODY_FONT = 'Calibri, Arial, sans-serif';
const HEADING_COLOR = '#1F3B57';
const RULE_COLOR = '#CCCCCC';

const sectionHeadingStyle = { fontSize: 20, fontWeight: 700, color: HEADING_COLOR, margin: '24px 0 10px', borderBottom: `1.5px solid ${HEADING_COLOR}`, paddingBottom: 4 };
const rowStyle = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: `1px solid ${RULE_COLOR}` };

const WORK_AUTH_LABELS = { Yes: 'Authorized to work in Uganda', No: 'Not authorized to work in Uganda', Sponsorship: 'Would need sponsorship to work in Uganda' };
const RELOCATE_LABELS = { Yes: 'Yes', No: 'No', Depends: 'Depends on the offer' };

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
}

export default function GeneratedCvPrintLayout({ candidate, application, vacancyTitle, vacancyJobRef }) {
  const c = candidate || {};
  const a = application || {};
  const referees = (a.referees || []).filter((r) => r?.name);

  const contactLine = [c.email, c.phone, c.location].filter(Boolean).join('  |  ');
  const idLine = c.nationalId ? `${c.idType === 'Passport' ? 'Passport' : 'National ID'}: ${c.nationalId}` : null;

  return (
    <div style={{ width: 794, boxSizing: 'border-box', fontFamily: BODY_FONT, color: '#000', fontSize: 15, lineHeight: 1.4, background: '#fff' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, margin: '0 0 4px' }}>{c.fullName}</h1>
      {contactLine && <p style={{ margin: '0 0 4px', color: '#333' }}>{contactLine}</p>}
      <p style={{ margin: '0 0 4px', color: '#333' }}>
        {[idLine, c.workAuthorization && WORK_AUTH_LABELS[c.workAuthorization]].filter(Boolean).join('  |  ')}
      </p>
      {(c.linkedinUrl || c.portfolioUrl) && (
        <p style={{ margin: '0 0 4px', color: '#333' }}>{[c.linkedinUrl, c.portfolioUrl].filter(Boolean).join('  |  ')}</p>
      )}

      <div style={{ background: '#F2F5F8', border: `1px solid ${RULE_COLOR}`, borderRadius: 4, padding: '10px 14px', marginTop: 16 }}>
        <strong>Applying for:</strong> {vacancyTitle}{vacancyJobRef ? ` (${vacancyJobRef})` : ''}
      </div>

      <h2 style={sectionHeadingStyle}>EDUCATION</h2>
      {(c.education || []).length === 0 && <p style={{ color: '#777' }}>None on file.</p>}
      {(c.education || []).map((e) => (
        <div key={e.id} style={rowStyle}>
          <span><strong>{e.qualificationLevel || e.qualificationLevelText}</strong> in {e.fieldOfStudy} &mdash; {e.institution}{e.cgpa ? `, CGPA ${e.cgpa}` : ''}</span>
          <span style={{ color: '#555', whiteSpace: 'nowrap' }}>{e.yearCompleted || 'In progress'}</span>
        </div>
      ))}

      <h2 style={sectionHeadingStyle}>WORK EXPERIENCE</h2>
      {(c.workExperience || []).length === 0 && <p style={{ color: '#777' }}>None on file.</p>}
      {(c.workExperience || []).map((w) => (
        <div key={w.id} style={{ padding: '6px 0', borderBottom: `1px solid ${RULE_COLOR}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span><strong>{w.jobTitle}</strong> &mdash; {w.employer}</span>
            <span style={{ color: '#555', whiteSpace: 'nowrap' }}>{formatDate(w.startDate)} &ndash; {w.endDate ? formatDate(w.endDate) : 'Present'}</span>
          </div>
          {(w.duties || []).length > 0 && (
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {w.duties.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
        </div>
      ))}

      {(c.examGrades || []).length > 0 && (
        <>
          <h2 style={sectionHeadingStyle}>EXAMINATION RESULTS</h2>
          {c.examGrades.map((g) => (
            <div key={g.id} style={rowStyle}>
              <span>{g.level === 'ALevel' ? 'A-Level' : 'O-Level'} &mdash; {g.subject}</span>
              <span style={{ fontWeight: 700 }}>{g.grade}</span>
            </div>
          ))}
        </>
      )}

      {(c.certificates || []).length > 0 && (
        <>
          <h2 style={sectionHeadingStyle}>CERTIFICATES</h2>
          {c.certificates.map((cert) => (
            <div key={cert.id} style={rowStyle}>
              <span><strong>{cert.name}</strong>{cert.issuingOrganization ? ` — ${cert.issuingOrganization}` : ''}</span>
              <span style={{ color: '#555', whiteSpace: 'nowrap' }}>{formatDate(cert.issueDate) || ''}</span>
            </div>
          ))}
        </>
      )}

      <h2 style={sectionHeadingStyle}>APPLICATION DETAILS</h2>
      <div style={rowStyle}><span>Open to relocating</span><span>{RELOCATE_LABELS[a.openToRelocate] || '—'}</span></div>
      <div style={rowStyle}><span>Desired salary</span><span>{a.desiredSalary || '—'}</span></div>
      <div style={rowStyle}><span>Earliest start date</span><span>{formatDate(a.earliestStartDate) || '—'}</span></div>
      {a.whyThisRole && (
        <div style={{ padding: '8px 0' }}>
          <strong>Why this role:</strong>
          <p style={{ margin: '4px 0 0' }}>{a.whyThisRole}</p>
        </div>
      )}

      <h2 style={sectionHeadingStyle}>REFEREES</h2>
      {referees.length === 0 && <p style={{ color: '#777' }}>None provided.</p>}
      {referees.map((r, i) => (
        <div key={i} style={{ padding: '6px 0', borderBottom: `1px solid ${RULE_COLOR}` }}>
          <strong>{r.name}</strong>{r.relationship ? ` — ${r.relationship}` : ''}{r.organization ? `, ${r.organization}` : ''}
          <div style={{ color: '#555' }}>{[r.phone, r.email].filter(Boolean).join('  |  ')}</div>
        </div>
      ))}
    </div>
  );
}
