import React from 'react';
import TextField from './TextField';
import RichTextField from './RichTextField';
import Select from './Select';
import BulletListEditor from './BulletListEditor';
import DesirableRequirementsEditor from './DesirableRequirementsEditor';

const subtitle = { display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginTop: 18, marginBottom: 8 };

// Shared Job Purpose + Person Specification fields, used identically by
// both the create-vacancy form and the edit modal in HRDashboard.jsx, so
// the two never drift apart. `values` holds the relevant slice of
// whichever form state the caller owns (form/editForm); `onChange` takes
// a partial patch and is expected to merge it into that state.
//
// One merged Job Purpose field, not two - it used to sit alongside a
// separate "Job description" field, but the two were doing the same job,
// so this is now the only one, and it keeps the paste-preserving
// RichTextField (bold/lists/indentation survive a Word paste) that the
// old description field had rather than the plain-text box job purpose
// briefly had. No separate Principal Accountabilities input either - HR
// pastes the job purpose and principal accountabilities together as one
// block into this same field, exactly as they'll read on the advert,
// rather than re-typing them into a structured table.
export default function VacancyAdvertFields({ values, onChange }) {
  const set = (key) => (e) => onChange({ [key]: e.target.value });
  const setList = (key) => (list) => onChange({ [key]: list });

  return (
    <div>
      <h4 style={{ marginBottom: 4 }}>Job purpose</h4>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0 }}>
        Paste the job purpose and principal accountabilities together here, exactly as they should appear on the advert.
      </p>
      <RichTextField placeholder="Job purpose and principal accountabilities"
        value={values.jobPurpose} onChange={(html) => onChange({ jobPurpose: html })} />

      <h4 style={{ marginTop: 24, marginBottom: 0 }}>Person specifications</h4>

      <span style={subtitle}>Essential requirements</span>
      <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: '0 16px' }}>
        <TextField label="Minimum experience (years, optional)" type="number" min="0"
          value={values.minimumExperienceYears} onChange={set('minimumExperienceYears')} />
        <Select label="Minimum education level (optional)" value={values.minimumEducationLevel} onChange={set('minimumEducationLevel')}>
          <option value="">No minimum</option>
          <option value="Certificate">Certificate</option>
          <option value="Diploma">Diploma</option>
          <option value="Bachelors">Bachelor's</option>
          <option value="Masters">Master's</option>
          <option value="PhD">PhD</option>
        </Select>
      </div>
      <TextField label="Preferred field of study (optional, informational only)"
        placeholder="e.g. Aviation Management or related field"
        value={values.preferredFieldOfStudy} onChange={set('preferredFieldOfStudy')} />
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: -10 }}>
        Minimum experience and education are checked automatically during screening. Preferred field of study is shown to HR as a note only.
      </p>
      <BulletListEditor placeholder="Any other essential requirement not covered above (e.g. age limit, specific subject credits)"
        items={values.essentialRequirements} onChange={setList('essentialRequirements')} />

      <span style={subtitle}>Desirable requirements</span>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 8 }}>
        Each one becomes a Yes/No question candidates answer when applying. A "No" answer is shown to you as a flag - it never auto-fails a candidate.
      </p>
      <DesirableRequirementsEditor items={values.desirableRequirements} onChange={setList('desirableRequirements')} />

      <span style={subtitle}>General knowledge and cognitive aptitude</span>
      <BulletListEditor placeholder="e.g. Logical reasoning ability"
        items={values.generalKnowledge} onChange={setList('generalKnowledge')} />

      <span style={subtitle}>Special skills and attributes</span>
      <BulletListEditor placeholder="e.g. Excellent command of spoken and written English"
        items={values.specialSkills} onChange={setList('specialSkills')} />
    </div>
  );
}
