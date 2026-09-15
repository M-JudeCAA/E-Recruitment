import React, { useState } from 'react';
import TextField from './TextField';
import Select from './Select';
import Button from './Button';

const EDUCATION_LEVELS = [
  { value: 'OLevel', label: 'O-Level' },
  { value: 'ALevel', label: 'A-Level' },
  { value: 'Certificate', label: 'Certificate' },
  { value: 'Diploma', label: 'Diploma' },
  { value: 'Bachelors', label: "Bachelor's / Degree" },
  { value: 'Postgraduate', label: 'Postgraduate' },
  { value: 'Masters', label: "Master's" },
  { value: 'PhD', label: 'PhD' }
];
const educationLabel = (value) => EDUCATION_LEVELS.find((l) => l.value === value)?.label || value;

const O_LEVEL_GRADES = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const A_LEVEL_GRADES = ['A', 'B', 'C', 'D', 'E', 'O', 'F'];

// Every requirement type this builder can add, in dropdown order. `kind`
// drives which mini-form renders below the dropdown:
//  - 'scalar'/'scalar-select': one value bound straight to values[field] -
//    at most one of these can ever exist, so there's no separate "add"
//    step, just direct two-way binding (same convention TextField/Select
//    use everywhere else in this codebase).
//  - 'examGrade'/'custom': array types (requiredExamGrades/
//    essentialRequirements) - these do need a staged draft + explicit Add,
//    since more than one can exist.
const TYPES = [
  { key: 'minimumExperienceYears', label: 'Minimum years of experience', kind: 'scalar', field: 'minimumExperienceYears', inputType: 'number', min: '0' },
  { key: 'minimumEducationLevel', label: 'Minimum education level', kind: 'scalar-select', field: 'minimumEducationLevel', options: EDUCATION_LEVELS },
  { key: 'minimumAge', label: 'Minimum age', kind: 'scalar', field: 'minimumAge', inputType: 'number', min: '1' },
  { key: 'maximumAge', label: 'Maximum age', kind: 'scalar', field: 'maximumAge', inputType: 'number', min: '1' },
  { key: 'minimumFlyingHours', label: 'Minimum flying hours', kind: 'scalar', field: 'minimumFlyingHours', inputType: 'number', min: '0' },
  { key: 'minimumCGPA', label: 'Minimum CGPA', kind: 'scalar', field: 'minimumCGPA', inputType: 'number', min: '0', max: '5', step: '0.01' },
  { key: 'examGrade', label: 'O-Level / A-Level subject & grade', kind: 'examGrade' },
  { key: 'preferredFieldOfStudy', label: 'Preferred field of study (informational only)', kind: 'scalar', field: 'preferredFieldOfStudy', inputType: 'text' },
  { key: 'custom', label: 'Other requirement (free text)', kind: 'custom' }
];

// Preview wording deliberately mirrors VacancyAdvert.jsx's own Essential
// Requirements bullet list exactly, so what HR sees while building the
// form is literally what candidates will see on the advert - not a
// separate, potentially-drifting description of it.
function ageRequirementText(minimumAge, maximumAge) {
  return [minimumAge ? `${minimumAge}+` : null, maximumAge ? `${maximumAge} or under` : null].filter(Boolean).join(', ');
}

function previewRows(values) {
  const rows = [];
  if (values.minimumEducationLevel) rows.push({ id: 'minimumEducationLevel', text: `Minimum education: ${educationLabel(values.minimumEducationLevel)}`, onRemove: () => ({ minimumEducationLevel: '' }) });
  if (values.minimumExperienceYears) rows.push({ id: 'minimumExperienceYears', text: `Minimum experience: ${values.minimumExperienceYears} year(s)`, onRemove: () => ({ minimumExperienceYears: '' }) });
  const ageText = ageRequirementText(values.minimumAge, values.maximumAge);
  if (ageText) rows.push({ id: 'age', text: `Age: ${ageText} years`, onRemove: () => ({ minimumAge: '', maximumAge: '' }) });
  if (values.minimumFlyingHours) rows.push({ id: 'minimumFlyingHours', text: `Minimum flying hours: ${values.minimumFlyingHours}`, onRemove: () => ({ minimumFlyingHours: '' }) });
  if (values.minimumCGPA) rows.push({ id: 'minimumCGPA', text: `Minimum CGPA: ${values.minimumCGPA}`, onRemove: () => ({ minimumCGPA: '' }) });
  (values.requiredExamGrades || []).forEach((r) => rows.push({
    id: r.id, text: `${r.level === 'ALevel' ? 'A-Level' : 'O-Level'} ${r.subject}: grade ${r.minGrade} or better`,
    onRemove: () => ({ requiredExamGrades: (values.requiredExamGrades || []).filter((x) => x.id !== r.id) })
  }));
  if (values.preferredFieldOfStudy) rows.push({ id: 'preferredFieldOfStudy', text: `Preferred field of study: ${values.preferredFieldOfStudy} (shown to HR as a note only, not machine-checked)`, onRemove: () => ({ preferredFieldOfStudy: '' }) });
  (values.essentialRequirements || []).forEach((text, i) => rows.push({
    id: `custom-${i}`, text,
    onRemove: () => ({ essentialRequirements: (values.essentialRequirements || []).filter((_, idx) => idx !== i) })
  }));
  return rows;
}

const previewStyle = { fontSize: 12, color: 'var(--color-primary-dark)', fontStyle: 'italic', marginTop: 4 };
const rowInputStyle = { padding: '11px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)' };

export default function EssentialRequirementsBuilder({ values, onChange }) {
  const [typeKey, setTypeKey] = useState(TYPES[0].key);
  const [draftLevel, setDraftLevel] = useState('OLevel');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftGrade, setDraftGrade] = useState('');
  const [draftCustom, setDraftCustom] = useState('');

  const type = TYPES.find((t) => t.key === typeKey);
  const rows = previewRows(values);

  const addExamGrade = () => {
    if (!draftSubject.trim() || !draftGrade) return;
    onChange({ requiredExamGrades: [...(values.requiredExamGrades || []), { id: crypto.randomUUID(), level: draftLevel, subject: draftSubject.trim(), minGrade: draftGrade }] });
    setDraftSubject('');
    setDraftGrade('');
  };
  const addCustom = () => {
    if (!draftCustom.trim()) return;
    onChange({ essentialRequirements: [...(values.essentialRequirements || []), draftCustom.trim()] });
    setDraftCustom('');
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <Select label="Requirement type" value={typeKey} onChange={(e) => setTypeKey(e.target.value)} style={{ maxWidth: 340 }}>
        {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </Select>

      {type.kind === 'scalar' && (
        <>
          <TextField label={type.label} type={type.inputType} min={type.min} max={type.max} step={type.step}
            value={values[type.field] || ''} onChange={(e) => onChange({ [type.field]: e.target.value })} />
          {values[type.field] && (() => {
            const rowId = type.field === 'minimumAge' || type.field === 'maximumAge' ? 'age' : type.field;
            const match = rows.find((r) => r.id === rowId);
            return match ? <div style={previewStyle}>Preview: "{match.text}"</div> : null;
          })()}
        </>
      )}

      {type.kind === 'scalar-select' && (
        <>
          <Select label={type.label} value={values[type.field] || ''} onChange={(e) => onChange({ [type.field]: e.target.value })}>
            <option value="">No minimum</option>
            {type.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {values[type.field] && <div style={previewStyle}>Preview: "Minimum education: {educationLabel(values[type.field])}"</div>}
        </>
      )}

      {type.kind === 'examGrade' && (
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <select value={draftLevel} onChange={(e) => { setDraftLevel(e.target.value); setDraftGrade(''); }} style={{ ...rowInputStyle, width: 100 }}>
              <option value="OLevel">O-Level</option>
              <option value="ALevel">A-Level</option>
            </select>
            <input value={draftSubject} placeholder="Subject, e.g. Mathematics" onChange={(e) => setDraftSubject(e.target.value)}
              style={{ ...rowInputStyle, flex: 1, minWidth: 140 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              Minimum grade
              <select value={draftGrade} onChange={(e) => setDraftGrade(e.target.value)} style={{ ...rowInputStyle, width: 70 }}>
                <option value="">Select</option>
                {(draftLevel === 'ALevel' ? A_LEVEL_GRADES : O_LEVEL_GRADES).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <Button type="button" variant="ghost" style={{ padding: '8px 12px', fontSize: 13 }} onClick={addExamGrade}>+ Add</Button>
          </div>
          {draftSubject.trim() && draftGrade && (
            <div style={previewStyle}>Preview: "{draftLevel === 'ALevel' ? 'A-Level' : 'O-Level'} {draftSubject.trim()}: grade {draftGrade} or better"</div>
          )}
        </div>
      )}

      {type.kind === 'custom' && (
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <input value={draftCustom} placeholder="e.g. Valid Air Traffic Control licence"
              onChange={(e) => setDraftCustom(e.target.value)}
              style={{ ...rowInputStyle, flex: 1 }} />
            <Button type="button" variant="ghost" style={{ padding: '8px 12px', fontSize: 13 }} onClick={addCustom}>+ Add</Button>
          </div>
          {draftCustom.trim() && <div style={previewStyle}>Preview: "{draftCustom.trim()}"</div>}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Essential requirements added so far ({rows.length})
          </span>
          {rows.map((row) => (
            <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
              <span>{row.text}</span>
              <button type="button" onClick={() => onChange(row.onRemove())}
                style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>&times;</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
