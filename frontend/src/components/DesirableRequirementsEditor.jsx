import React from 'react';
import Button from './Button';

// Editor for Person Specification's Desirable Requirements: repeatable
// { id, text } rows. Each becomes a Yes/No question candidates answer at
// application time (see apply-wizard/QuestionsStep.jsx) - `id` is
// generated once, here, and kept stable across edits so an
// already-submitted candidate answer (which snapshots this id) stays
// correctly attributable even if the wording is later tweaked. No
// internal heading - the caller supplies the "Desirable Requirements"
// subtitle as part of the Person Specification section layout.
export default function DesirableRequirementsEditor({ items, onChange }) {
  const rows = items || [];

  const updateText = (index, text) => {
    const next = [...rows];
    next[index] = { ...next[index], text };
    onChange(next);
  };
  const addRow = () => onChange([...rows, { id: crypto.randomUUID(), text: '' }]);
  const removeRow = (index) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div style={{ marginBottom: 20 }}>
      {rows.map((row, index) => (
        <div key={row.id || index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={row.text}
            placeholder="e.g. Ready to work shifts including nights, weekends and public holidays"
            onChange={(e) => updateText(index, e.target.value)}
            style={{ flex: 1, padding: '11px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)' }}
          />
          <button type="button" onClick={() => removeRow(index)}
            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}>&times;</button>
        </div>
      ))}
      <Button type="button" variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={addRow}>+ Add desirable requirement</Button>
    </div>
  );
}
