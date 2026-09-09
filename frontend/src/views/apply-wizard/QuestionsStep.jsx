import TextField from '../../components/TextField';
import TextArea from '../../components/TextArea';
import Select from '../../components/Select';

// Application-level answers - unlike the Profile step's candidate-level
// fields, these vary per application and are saved onto this specific
// Application row (see ApplyForm.jsx's saveDraft). Work authorization is
// asked once, on the Profile step, rather than duplicated here.
//
// desirableRequirements comes straight from the vacancy's Person
// Specification (see VacancyAdvert) - each one gets its own Yes/No
// question here. Answering "No" is never a reason an application gets
// auto-rejected; HR sees the answer as a flag alongside everything else,
// same as this step's other questions.
export default function QuestionsStep({ questions, set, desirableRequirements, desirableAnswers, setDesirableAnswer }) {
  return (
    <div>
      <Select label="Open to relocating to Entebbe?" required value={questions.openToRelocate} onChange={set('openToRelocate')}>
        <option value="">Select one</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
        <option value="Depends">Depends on the offer</option>
      </Select>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Desired salary" hint="Monthly, UGX or USD" value={questions.desiredSalary} onChange={set('desiredSalary')} />
        <TextField label="Earliest start date" type="date" value={questions.earliestStartDate} onChange={set('earliestStartDate')} />
      </div>
      <TextArea label="Why this role?" required rows={5} hint="A few sentences on what draws you to this role and to UCAA"
        value={questions.whyThisRole} onChange={set('whyThisRole')} />

      {desirableRequirements?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
            A few more specifics for this role
          </span>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 14 }}>
            These are desirable, not mandatory - answering "No" will not disqualify your application.
          </p>
          {desirableRequirements.map((req) => (
            <Select key={req.id} label={req.text} required
              value={desirableAnswers[req.id] === undefined ? '' : (desirableAnswers[req.id] ? 'Yes' : 'No')}
              onChange={setDesirableAnswer(req.id)}>
              <option value="">Select one</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </Select>
          ))}
        </div>
      )}
    </div>
  );
}
