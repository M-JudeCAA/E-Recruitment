import React from 'react';
import { X, Plus, Crown } from 'lucide-react';
import { inputStyle, sectionLabel, hintText, chipStyle } from './formStyles';

export const emptyPanelist = () => ({ name: '', trade: '', email: '', isChair: false });

const samePerson = (a, b) => (a.email && b.email
  ? a.email.trim().toLowerCase() === b.email.trim().toLowerCase()
  : a.name.trim().toLowerCase() === b.name.trim().toLowerCase());

// The panel for a round or session: name, role/trade, optional email (for
// the calendar invite and scoring link) and who chairs. Panelists don't
// need system accounts. `suggestions` are people who sat on this vacancy's
// panels before - one click adds them back.
export default function PanelEditor({ value, onChange, suggestions = [] }) {
  const panel = value.length ? value : [emptyPanelist()];

  const update = (index, field, v) => onChange(panel.map((p, i) => (i === index ? { ...p, [field]: v } : p)));
  const setChair = (index) => onChange(panel.map((p, i) => ({ ...p, isChair: i === index ? !p.isChair : false })));
  const remove = (index) => onChange(panel.filter((_, i) => i !== index));
  const add = (p = emptyPanelist()) => {
    const filled = panel.filter((x) => x.name.trim());
    onChange([...filled, { ...emptyPanelist(), ...p, isChair: false }]);
  };

  const unused = suggestions.filter((s) => !panel.some((p) => p.name.trim() && samePerson(p, s)));

  return (
    <div>
      <span style={sectionLabel}>Interview panel</span>
      <p style={{ ...hintText, margin: '0 0 8px' }}>
        No system account needed. Panelists with an email get a calendar invite now and a scoring link after the interview.
      </p>
      {unused.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
          <span style={hintText}>Used on this vacancy before:</span>
          {unused.slice(0, 8).map((s) => (
            <button key={`${s.name}-${s.email || ''}`} type="button" style={chipStyle(false)} onClick={() => add(s)}>
              + {s.name}{s.trade ? ` (${s.trade})` : ''}
            </button>
          ))}
        </div>
      )}
      {panel.map((p, index) => (
        <div key={index} style={{ display: 'grid', gridTemplateColumns: '32px minmax(0, 2fr) minmax(0, 2fr) minmax(0, 2fr) 28px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
          <button
            type="button" onClick={() => setChair(index)} aria-pressed={p.isChair}
            title={p.isChair ? 'Panel chair' : 'Make chair'} aria-label={p.isChair ? `${p.name || 'Panelist'} is the chair` : 'Make chair'}
            style={{
              border: `1px solid ${p.isChair ? 'var(--color-gold)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)',
              background: p.isChair ? '#FDF3E1' : 'var(--color-bg)', height: 34, cursor: 'pointer',
              color: p.isChair ? 'var(--color-gold-dark)' : 'var(--color-text-muted)'
            }}
          >
            <Crown size={15} />
          </button>
          <input aria-label="Panelist name" placeholder="Name" value={p.name} onChange={(e) => update(index, 'name', e.target.value)} style={inputStyle} />
          <input aria-label="Panelist role" placeholder="Role / trade" value={p.trade || ''} onChange={(e) => update(index, 'trade', e.target.value)} style={inputStyle} />
          <input aria-label="Panelist email" type="email" placeholder="Email (optional)" value={p.email || ''} onChange={(e) => update(index, 'email', e.target.value)} style={inputStyle} />
          {panel.length > 1 ? (
            <button type="button" aria-label="Remove panelist" onClick={() => remove(index)}
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 0 }}>
              <X size={16} />
            </button>
          ) : <span />}
        </div>
      ))}
      <button type="button" onClick={() => add()} style={{ ...chipStyle(false), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Plus size={13} /> Add panelist
      </button>
    </div>
  );
}

// Rows with a name, for sending to the API.
export function cleanPanel(panel) {
  return panel
    .filter((p) => p.name.trim())
    .map((p) => ({ name: p.name.trim(), trade: p.trade?.trim() || undefined, email: p.email?.trim() || undefined, isChair: !!p.isChair }));
}
