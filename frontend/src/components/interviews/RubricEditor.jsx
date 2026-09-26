import React from 'react';
import { X, Plus } from 'lucide-react';
import { RUBRIC_TEMPLATES } from '../../utils/interviews';
import { inputStyle, sectionLabel, hintText, chipStyle } from './formStyles';

// Scoring rubric for a round: named criteria with a 1-10 weight each. Every
// panelist rates each criterion 1-5 and the 0-100 score is computed from
// that, so the panel scores against the same yardstick. Empty = the panel
// gives one overall score instead. `previous` is the rubric last used on
// this vacancy, offered as a one-click starting point.
export default function RubricEditor({ value, onChange, previous, disabled }) {
  const criteria = value || [];
  const totalWeight = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0);

  const update = (index, field, v) => onChange(criteria.map((c, i) => (i === index ? { ...c, [field]: v } : c)));
  const remove = (index) => onChange(criteria.filter((_, i) => i !== index));
  const add = () => onChange([...criteria, { name: '', weight: 1, description: '' }]);
  const use = (list) => onChange(list.map(({ name, weight, description }) => ({ name, weight, description: description || '' })));

  return (
    <div>
      <span style={sectionLabel}>Scoring rubric</span>
      <p style={{ ...hintText, margin: '0 0 8px' }}>
        Each panelist rates every criterion from 1 (poor) to 5 (outstanding); the weights turn that into a score out of 100.
        Leave empty to have the panel give one overall score instead.
      </p>
      {!disabled && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {previous?.length > 0 && (
            <button type="button" style={chipStyle(false)} onClick={() => use(previous)}>Reuse this vacancy's last rubric</button>
          )}
          {RUBRIC_TEMPLATES.map((t) => (
            <button key={t.key} type="button" style={chipStyle(false)} onClick={() => use(t.criteria)}>{t.label}</button>
          ))}
          {criteria.length > 0 && (
            <button type="button" style={chipStyle(false)} onClick={() => onChange([])}>No rubric (overall score)</button>
          )}
        </div>
      )}

      {criteria.map((c, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 72px minmax(0, 3fr) 28px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <input
            aria-label={`Criterion ${index + 1} name`} placeholder="Criterion" value={c.name} disabled={disabled}
            onChange={(e) => update(index, 'name', e.target.value)} style={inputStyle}
          />
          <input
            aria-label={`Criterion ${index + 1} weight`} type="number" min="1" max="10" value={c.weight} disabled={disabled}
            onChange={(e) => update(index, 'weight', e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle}
            title="Weight, 1-10"
          />
          <input
            aria-label={`Criterion ${index + 1} guidance`} placeholder="What the panel should look for (optional)" value={c.description || ''}
            disabled={disabled} onChange={(e) => update(index, 'description', e.target.value)} style={inputStyle}
          />
          {!disabled && (
            <button type="button" aria-label="Remove criterion" onClick={() => remove(index)}
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 0 }}>
              <X size={16} />
            </button>
          )}
        </div>
      ))}

      {criteria.length > 0 && (
        <div style={{ ...hintText, marginBottom: 6 }}>
          {criteria.map((c) => c.name && totalWeight ? `${c.name} ${Math.round(((Number(c.weight) || 0) / totalWeight) * 100)}%` : null).filter(Boolean).join(' · ')}
        </div>
      )}
      {!disabled && criteria.length < 12 && (
        <button type="button" onClick={add} style={{ ...chipStyle(false), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Add criterion
        </button>
      )}
      {disabled && <p style={hintText}>The rubric is locked because a panelist has already scored against it.</p>}
    </div>
  );
}
