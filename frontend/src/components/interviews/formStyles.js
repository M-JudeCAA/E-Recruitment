// Compact inline-input styling for the interview editors' row layouts,
// matching TextField/Select's border, radius and fill.
export const inputStyle = {
  padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 14, fontFamily: 'inherit', background: 'var(--color-bg-input)', minWidth: 0, boxSizing: 'border-box'
};

export const sectionLabel = {
  display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 6
};

export const hintText = { fontSize: 12, color: 'var(--color-text-muted)' };

export const chipStyle = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
  background: active ? 'var(--color-primary-light)' : 'var(--color-bg)',
  color: active ? 'var(--color-primary-dark)' : 'var(--color-text)'
});

export const ROUND_LABELS = {
  NoShow: 'No-show', RescheduleRequested: 'Asked to move', Pending: 'Awaiting reply', Confirmed: 'Confirmed'
};
