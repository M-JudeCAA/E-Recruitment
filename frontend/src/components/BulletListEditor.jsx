import React from 'react';
import Button from './Button';

// A plain add/edit/remove/reorder list of free-text bullets - used for
// the Person Specification's Essential Requirements, General Knowledge,
// and Special Skills sections, none of which need per-item identity
// beyond their text (unlike DesirableRequirementsEditor, whose items are
// individually answered by candidates and so need a stable id).
export default function BulletListEditor({ label, hint, items, onChange, placeholder }) {
  const list = items || [];

  const updateItem = (index, value) => {
    const next = [...list];
    next[index] = value;
    onChange(next);
  };
  const addItem = () => onChange([...list, '']);
  const removeItem = (index) => onChange(list.filter((_, i) => i !== index));

  return (
    <div style={{ marginBottom: 20 }}>
      {label && <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</span>}
      {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>{hint}</span>}
      {list.map((value, index) => (
        <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            value={value}
            placeholder={placeholder}
            onChange={(e) => updateItem(index, e.target.value)}
            style={{ flex: 1, padding: '11px 14px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)' }}
          />
          <button type="button" onClick={() => removeItem(index)}
            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}>&times;</button>
        </div>
      ))}
      <Button type="button" variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={addItem}>+ Add item</Button>
    </div>
  );
}
