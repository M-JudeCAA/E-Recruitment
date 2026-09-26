import React from 'react';
import RichTextField from './RichTextField';
import BulletListEditor from './BulletListEditor';
import EssentialRequirementsBuilder from './EssentialRequirementsBuilder';
import ScreeningQuestionsEditor from './ScreeningQuestionsEditor';

const sectionHeading = { display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--color-primary-dark)', marginTop: 24, marginBottom: 2 };
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
//
// Person Specification is organized as two umbrella sections - Requirements,
// then Additional Screening Criteria - matching how a real reference
// "Create Job" form (a separate Lovable-built HR console) frames the same
// ground. That reference form also drives its requirements through a single
// "Requirement Type" dropdown (rather than always-visible separate fields
// per type) and shows a live preview sentence as each one is built, plus a
// per-question Qualifying/Disqualifying usage select - EssentialRequirementsBuilder
// and ScreeningQuestionsEditor below port those same two UX patterns onto
// this form. Every field they touch is still the same vacancy field
// screeningService.js reads (minimumEducationLevel, minimumAge,
// requiredExamGrades, disqualifyingRequirements, ...) - this remains a
// presentation layer only, not a data-model change, so screening itself is
// unaffected by it.
export default function VacancyAdvertFields({ values, onChange }) {
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

      <span style={sectionHeading}>Requirements</span>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, marginBottom: 0 }}>
        Build essential and desirable requirements. Essential items below are checked automatically wherever the
        candidate's own profile data can verify them (education, experience, age, flying hours, O-Level/A-Level
        grades); anything that instead needs a direct question - a licence, citizenship, and the like - belongs in
        Additional Screening Criteria below.
      </p>

      <span style={subtitle}>Essential requirements</span>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 8 }}>
        Pick a requirement type from the dropdown, fill in its value, and add it - each one is checked automatically
        against the candidate's own profile data (education, experience, age, flying hours, O-Level/A-Level grades),
        never a self-declared answer. The preview line shows exactly how it will read on the advert.
      </p>
      <EssentialRequirementsBuilder values={values} onChange={onChange} />

      <span style={sectionHeading}>Additional Screening Criteria</span>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2, marginBottom: 8 }}>
        Custom questions for anything Requirements above can't verify automatically - a licence, citizenship, and the
        like. Each becomes a Yes/No question candidates answer when applying; the Usage dropdown decides what a "No"
        (or, for a Disqualifying question, an answer other than "Must answer") does - a Qualifying question only ever
        flags the mismatch for HR, while a Disqualifying question actually fails automated screening. The preview line
        below each question shows candidates and HR exactly what that means.
      </p>
      <span style={subtitle}>Screening questions</span>
      <ScreeningQuestionsEditor
        desirableItems={values.desirableRequirements}
        disqualifyingItems={values.disqualifyingRequirements}
        onChange={onChange}
      />

      <span style={subtitle}>General knowledge and cognitive aptitude</span>
      <BulletListEditor placeholder="e.g. Logical reasoning ability"
        items={values.generalKnowledge} onChange={setList('generalKnowledge')} />

      <span style={subtitle}>Special skills and attributes</span>
      <BulletListEditor placeholder="e.g. Excellent command of spoken and written English"
        items={values.specialSkills} onChange={setList('specialSkills')} />
    </div>
  );
}
