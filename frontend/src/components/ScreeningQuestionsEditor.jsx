import React from 'react';
import Button from './Button';

const rowInputStyle = { flex: 1, padding: '11px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)' };
const selectStyle = { padding: '8px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)' };
const numberInputStyle = { ...selectStyle, width: 70 };

// Unifies what used to be two separate editors - DesirableRequirementsEditor
// and DisqualifyingRequirementsEditor - into one list where each row picks
// its own "Usage" (Qualifying/Disqualifying) and "Answer type" (Yes/No or
// Number) from dropdowns, matching how the reference HR console frames the
// same choice ("Custom qualifier/disqualifier questions", each with a
// Usage select and an Answer-type select of yesno/number). Under the hood
// the two underlying vacancy fields (desirableRequirements/
// disqualifyingRequirements) are untouched - this component only decides,
// per row, which of the two arrays it belongs to and what shape its answer
// takes; screeningService.js and QuestionsStep.jsx read/write those same
// two fields exactly as before, just now answerType/minValue-aware.
//
// A single `onChange` patch callback, not two separate ones - switching a
// row's usage needs to update BOTH arrays in one go (remove from one, add
// to the other). Two separate onChange calls in the same handler is a real
// footgun here: React batches them, but each closes over the same
// not-yet-updated parent state, so the second call's `{...prevState}`
// spread silently reverts the first call's change - the row would appear
// to "duplicate" into both arrays instead of moving. One patch object
// covering both keys avoids that entirely.
export default function ScreeningQuestionsEditor({ desirableItems, disqualifyingItems, onChange }) {
  const desirable = desirableItems || [];
  const disqualifying = disqualifyingItems || [];
  const rows = [
    ...desirable.map((r) => ({ ...r, usage: 'qualifying', answerType: r.answerType === 'number' ? 'number' : 'yesno' })),
    ...disqualifying.map((r) => ({
      ...r, usage: 'disqualifying', answerType: r.answerType === 'number' ? 'number' : 'yesno',
      requiredAnswer: r.requiredAnswer === 'No' ? 'No' : 'Yes'
    }))
  ];

  const updateRow = (row, patch) => {
    if (row.usage === 'qualifying') {
      onChange({ desirableRequirements: desirable.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) });
    } else {
      onChange({ disqualifyingRequirements: disqualifying.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) });
    }
  };
  const changeUsage = (row, usage) => {
    if (usage === row.usage) return;
    // Both fields of the patch below carry only the row's own text/
    // answerType/minValue/requiredAnswer - never spread `row` itself,
    // which also carries the `usage` tag added above for display only and
    // has no place in the stored shape.
    if (usage === 'disqualifying') {
      onChange({
        desirableRequirements: desirable.filter((r) => r.id !== row.id),
        disqualifyingRequirements: [...disqualifying, {
          id: row.id, text: row.text, requiredAnswer: 'Yes',
          ...(row.answerType === 'number' ? { answerType: 'number', minValue: row.minValue } : {})
        }]
      });
    } else {
      onChange({
        disqualifyingRequirements: disqualifying.filter((r) => r.id !== row.id),
        desirableRequirements: [...desirable, {
          id: row.id, text: row.text,
          ...(row.answerType === 'number' ? { answerType: 'number', minValue: row.minValue } : {})
        }]
      });
    }
  };
  const changeAnswerType = (row, answerType) => {
    if (answerType === row.answerType) return;
    updateRow(row, answerType === 'number' ? { answerType: 'number', minValue: '' } : { answerType: 'yesno', minValue: undefined });
  };
  const removeRow = (row) => {
    if (row.usage === 'qualifying') onChange({ desirableRequirements: desirable.filter((r) => r.id !== row.id) });
    else onChange({ disqualifyingRequirements: disqualifying.filter((r) => r.id !== row.id) });
  };
  const addRow = () => onChange({ desirableRequirements: [...desirable, { id: crypto.randomUUID(), text: '' }] });

  return (
    <div style={{ marginBottom: 20 }}>
      {rows.map((row) => (
        <div key={row.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={row.text}
              placeholder="e.g. Do you hold a valid Air Traffic Control licence?"
              onChange={(e) => updateRow(row, { text: e.target.value })}
              style={rowInputStyle}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              Usage
              <select value={row.usage} onChange={(e) => changeUsage(row, e.target.value)} style={selectStyle}>
                <option value="qualifying">Qualifying ✓</option>
                <option value="disqualifying">Disqualifying ✗</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              Answer type
              <select value={row.answerType} onChange={(e) => changeAnswerType(row, e.target.value)} style={selectStyle}>
                <option value="yesno">Yes / No</option>
                <option value="number">Number</option>
              </select>
            </label>
            {row.answerType === 'number' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                Minimum value
                <input type="number" value={row.minValue ?? ''} onChange={(e) => updateRow(row, { minValue: e.target.value })} style={numberInputStyle} />
              </label>
            ) : row.usage === 'disqualifying' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                Must answer
                <select value={row.requiredAnswer} onChange={(e) => updateRow(row, { requiredAnswer: e.target.value })} style={selectStyle}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
            )}
            <button type="button" onClick={() => removeRow(row)}
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}>&times;</button>
          </div>
          {row.text.trim() && (row.answerType !== 'number' || row.minValue !== '') && (
            <div style={{ fontSize: 12, color: 'var(--color-primary-dark)', fontStyle: 'italic', marginTop: 4 }}>
              {row.answerType === 'number'
                ? (row.usage === 'qualifying'
                  ? `Preview: candidates are asked "${row.text.trim()}" and answer with a number - reaching at least ${row.minValue} is shown to you as a match, but never fails automated screening.`
                  : `Preview: candidates are asked "${row.text.trim()}" and answer with a number - below ${row.minValue} fails automated screening.`)
                : (row.usage === 'qualifying'
                  ? `Preview: candidates are asked "${row.text.trim()}" - answering the other way is shown to you as a flag, but never fails automated screening.`
                  : `Preview: candidates are asked "${row.text.trim()}" - must answer ${row.requiredAnswer} or the application is flagged as ineligible in automated screening.`)}
            </div>
          )}
        </div>
      ))}
      <Button type="button" variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={addRow}>+ Add screening question</Button>
    </div>
  );
}
