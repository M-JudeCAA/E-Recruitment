// The full vacancy write-up - title, department, ref, deadline, and the
// complete rich-text description. Its own dedicated first step rather than
// a block pinned above every other step, so the actual form (Profile,
// Documents, Questions...) isn't crowded by a job posting the candidate
// has already read by the time they're filling anything in.
export default function JobDetailsStep({ vacancy }) {
  const facts = [
    ['Department', vacancy.department?.name
      ? `${vacancy.department.name}${vacancy.department.directorate?.name ? ', ' + vacancy.department.directorate.name : ''}`
      : null],
    ['Reference', vacancy.jobRef],
    ['Positions available', vacancy.positionsRequired],
    ['Application deadline', vacancy.deadline ? new Date(vacancy.deadline).toLocaleDateString() : null],
    ['Salary scale', vacancy.salaryScale],
    ['Minimum experience', vacancy.minimumExperienceYears ? `${vacancy.minimumExperienceYears} year(s)` : null],
    ['Minimum education', vacancy.minimumEducationLevel],
  ].filter(([, value]) => value);

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-primary-dark)', marginBottom: 12 }}>
        {vacancy.title}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '4px 24px', marginBottom: 20 }}>
        {facts.map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{value}</span>
          </div>
        ))}
      </div>

      {vacancy.description && (
        <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: vacancy.description }} />
      )}
    </div>
  );
}
