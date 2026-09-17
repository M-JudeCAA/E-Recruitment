import TextField from '../../components/TextField';
import TextArea from '../../components/TextArea';
import Select from '../../components/Select';

// Application-level answers - unlike the Profile step's candidate-level
// fields, these vary per application and are saved onto this specific
// Application row (see ApplyForm.jsx's saveDraft). Work authorization is
// asked once, on the Profile step, rather than duplicated here.
//
// desirableRequirements comes straight from the vacancy's Person
// Specification (see VacancyAdvert) - each one gets its own question here,
// Yes/No by default or a plain number input when req.answerType ===
// 'number' (see ScreeningQuestionsEditor.jsx, the HR-side authoring UI).
// Not meeting one is never a reason an application gets auto-rejected; HR
// sees the answer as a flag alongside everything else, same as this step's
// other questions.
//
// disqualifyingRequirements is the mandatory counterpart - same
// yesno/number split, but not meeting one DOES cause automated screening
// to fail (see backend screeningService.screenApplication). Still never
// blocks the application itself from being submitted.
export default function QuestionsStep({
  questions, set, vacancyLocation, desirableRequirements, desirableAnswers, setDesirableAnswer,
  disqualifyingRequirements, disqualifyingAnswers, setDisqualifyingAnswer
}) {
  // CHANGED - this used to always say "Entebbe" regardless of where the
  // vacancy actually is, since vacancy.location was never passed in here.
  const relocateLabel = vacancyLocation ? `Open to relocating to ${vacancyLocation}?` : 'Open to relocating for this role?';
  return (
    <div>
      <Select label={relocateLabel} required value={questions.openToRelocate} onChange={set('openToRelocate')}>
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

      {disqualifyingRequirements?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
            Eligibility for this role
          </span>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 14 }}>
            These determine your eligibility for this specific role - please answer accurately.
          </p>
          {disqualifyingRequirements.map((req) => req.answerType === 'number' ? (
            <TextField key={req.id} label={req.text} required type="number"
              hint={req.minValue !== undefined ? `Must be at least ${req.minValue}` : undefined}
              value={disqualifyingAnswers[req.id] === undefined ? '' : disqualifyingAnswers[req.id]}
              onChange={setDisqualifyingAnswer(req.id)} />
          ) : (
            <Select key={req.id} label={req.text} required
              value={disqualifyingAnswers[req.id] === undefined ? '' : (disqualifyingAnswers[req.id] ? 'Yes' : 'No')}
              onChange={setDisqualifyingAnswer(req.id)}>
              <option value="">Select one</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </Select>
          ))}
        </div>
      )}

      {desirableRequirements?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
            A few more specifics for this role
          </span>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0, marginBottom: 14 }}>
            These are desirable, not mandatory - answering "No" (or leaving a number below the mark) will not disqualify your application.
          </p>
          {desirableRequirements.map((req) => req.answerType === 'number' ? (
            <TextField key={req.id} label={req.text} required type="number"
              value={desirableAnswers[req.id] === undefined ? '' : desirableAnswers[req.id]}
              onChange={setDesirableAnswer(req.id)} />
          ) : (
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
