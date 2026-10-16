import React, { useId, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';

// A field that suggests from a list the page already has as the person types
// and only counts a value once it is picked from the suggestions - the
// in-memory counterpart of DirectoryPersonField (same look, .ws-suggest).
// Typing after a pick un-picks it (onType); focusing the empty field shows
// the first suggestions. Arrow keys, Enter and Escape work in the list.
//
// options: [{ id, label, detail? }] - each word typed must appear in the
// label or the detail.
const SHOWN = 8;

export function matchOptions(options, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((o) => {
    const text = `${o.label} ${o.detail || ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export default function SuggestField({
  label, required, value, picked, options, onType, onPick, placeholder, hint, error, disabled, emptyMessage
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const matches = matchOptions(options || [], picked ? '' : value).slice(0, SHOWN);

  const pick = (option) => {
    setOpen(false);
    onPick(option);
  };
  const onKeyDown = (e) => {
    if (!open || !matches.length) {
      if (e.key === 'ArrowDown') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[active] || matches[0]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  const message = String(value || '').trim() ? (emptyMessage || `Nothing matches “${value.trim()}”.`) : '';

  return (
    <label style={{ display: 'block', marginBottom: 22, maxWidth: 640, position: 'relative' }}>
      <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
      </span>
      <span style={{ position: 'relative', display: 'block' }}>
        {picked
          ? <CheckCircle2 size={16} aria-hidden style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-success)' }} />
          : <Search size={15} aria-hidden style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-text-muted)' }} />}
        <input
          value={value}
          disabled={disabled}
          role="combobox" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls={listId}
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => { onType(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => { setActive(0); setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          style={{
            display: 'block', width: '100%', padding: '11px 14px 11px 36px', boxSizing: 'border-box',
            border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)',
            fontSize: 'inherit', fontFamily: 'inherit', background: disabled ? 'var(--color-bg-subtle)' : 'var(--color-bg-input)'
          }}
        />
        {open && !disabled && (matches.length > 0 || message) && (
          <span className="ws-suggest" role="presentation">
            {matches.length > 0 ? (
              <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
                {matches.map((o, i) => (
                  <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                    className={i === active ? 'on' : undefined}
                    onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                    <b>{o.label}</b>
                    {o.detail && <small>{o.detail}</small>}
                  </li>
                ))}
              </ul>
            ) : <span className="msg">{message}</span>}
          </span>
        )}
      </span>
      {error ? (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>{error}</span>
      ) : hint && (
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6 }}>{hint}</span>
      )}
    </label>
  );
}
