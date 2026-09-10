export default function ReviewStep({ profile, cv, coverLetter, profileDetails, questions, internalProfile, candidateType, goTo, stepIndexes, desirableRequirements, desirableAnswers }) {
  const WORK_AUTH_LABELS = { Yes: 'Yes', No: 'No', Sponsorship: 'Would need sponsorship' };
  const RELOCATE_LABELS = { Yes: 'Yes', No: 'No', Depends: 'Depends on the offer' };

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
        ['CV', cv ? cv.name : 'Not attached'],
        ['Cover letter', coverLetter ? coverLetter.name : 'Not attached'],
        ['Portfolio', profileDetails.portfolioUrl || '—'],
      ],
    },
    {
      i: stepIndexes.questions,
      title: 'Questions',
      rows: [
        ['Open to relocating', RELOCATE_LABELS[questions.openToRelocate] || '—'],
        ['Desired salary', questions.desiredSalary || '—'],
        ['Earliest start', questions.earliestStartDate || '—'],
        ['Why this role', questions.whyThisRole || '—'],
        ...(desirableRequirements || []).map((req) => [
          req.text, desirableAnswers[req.id] === undefined ? '—' : (desirableAnswers[req.id] ? 'Yes' : 'No')
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
          {section.rows.map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--color-text)', textAlign: 'right', maxWidth: '60%' }}>{value || '—'}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
