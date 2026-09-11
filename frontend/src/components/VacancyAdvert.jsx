import React from 'react';

// Renders a vacancy in UCAA's standard job-advertisement layout (header
// facts, Job Purpose, Person Specification). Shared between the
// candidate-facing job details step
// (frontend/src/views/apply-wizard/JobDetailsStep.jsx) and the HR
// "Preview" modal (frontend/src/views/HRDashboard.jsx) - both pass the
// same flat shape, one built from a saved vacancy, the other assembled
// live from the create-vacancy form state before it's ever saved.
//
// No separate Principal Accountabilities or "additional information"
// section - `jobPurpose` is sanitized rich-text HTML (see
// backend/src/utils/htmlSanitizer.js) covering job purpose, principal
// accountabilities, and anything else HR pastes in as one block, so it's
// rendered here with dangerouslySetInnerHTML rather than as plain text.
export default function VacancyAdvert({
  jobRef, title, departmentLabel, reportsToName, salaryScale, positionsRequired, deadline,
  jobPurpose, essentialRequirements,
  minimumEducationLevel, minimumExperienceYears, preferredFieldOfStudy,
  desirableRequirements, generalKnowledge, specialSkills
}) {
  const facts = [
    ['Job Ref', jobRef || 'Assigned automatically when created'],
    ['Position', title],
    ['Reports To', reportsToName],
    ['Department', departmentLabel],
    ['Salary Scale', salaryScale],
    ['Vacancies', positionsRequired],
    ['Application Deadline', deadline ? new Date(deadline).toLocaleDateString() : null],
  ].filter(([, value]) => value);

  const hasEssential = essentialRequirements?.length || minimumEducationLevel || minimumExperienceYears || preferredFieldOfStudy;

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-primary-dark)', marginBottom: 4 }}>{title || 'Untitled position'}</div>

      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '12px 0 20px' }}>
        <tbody>
          {facts.map(([label, value]) => (
            <tr key={label}>
              <td style={{ padding: '3px 12px 3px 0', fontSize: 13, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
              <td style={{ padding: '3px 0', fontSize: 13, color: 'var(--color-text)' }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {jobPurpose && (
        <>
          <h4 style={{ marginBottom: 6 }}>Job Purpose</h4>
          {/* rich-text-content is scoped to just this pasted HTML (not the
              whole advert, as it used to be) - it's the only place raw
              pasted content with its own inconsistent heading sizes lives;
              the facts table and requirement lists above/below are
              deliberately sized inline and shouldn't be flattened to the
              page's base font-size along with it. See theme.css's comment
              on .rich-text-content * for why the override exists at all. */}
          <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: jobPurpose }} />
        </>
      )}

      {(hasEssential || desirableRequirements?.length > 0 || generalKnowledge?.length > 0 || specialSkills?.length > 0) && (
        <h4 style={{ marginBottom: 6 }}>Person Specifications</h4>
      )}

      {hasEssential && (
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13, color: 'var(--color-primary-dark)' }}>Essential Requirements</strong>
          <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
            {minimumEducationLevel && <li>Minimum education: {minimumEducationLevel}</li>}
            {minimumExperienceYears ? <li>Minimum experience: {minimumExperienceYears} year(s)</li> : null}
            {preferredFieldOfStudy && <li>Preferred field of study: {preferredFieldOfStudy}</li>}
            {(essentialRequirements || []).map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {desirableRequirements?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13, color: 'var(--color-primary-dark)' }}>Desirable Requirements</strong>
          <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
            {desirableRequirements.map((r) => <li key={r.id || r.text}>{r.text}</li>)}
          </ul>
        </div>
      )}

      {generalKnowledge?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13, color: 'var(--color-primary-dark)' }}>General Knowledge and Cognitive Aptitude</strong>
          <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
            {generalKnowledge.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {specialSkills?.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 13, color: 'var(--color-primary-dark)' }}>Special Skills and Attributes</strong>
          <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
            {specialSkills.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

    </div>
  );
}
