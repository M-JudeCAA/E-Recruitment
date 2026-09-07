import TextField from '../../components/TextField';
import TextArea from '../../components/TextArea';
import Select from '../../components/Select';

// Application-level answers - unlike the Profile step's candidate-level
// fields, these vary per application and are saved onto this specific
// Application row (see ApplyForm.jsx's saveDraft). Work authorization is
// asked once, on the Profile step, rather than duplicated here.
export default function QuestionsStep({ questions, set }) {
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
    </div>
  );
}
