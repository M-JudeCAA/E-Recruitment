import React, { useEffect, useId, useRef, useState } from 'react';
import { Search, UserCheck } from 'lucide-react';

// A name field that suggests UCAA staff from the Microsoft directory as the
// person types (from 2 characters, debounced); picking one hands the whole
// entry - { name, email, jobTitle, department } - to onPick, so the fields
// around it fill in. Typing again after a pick un-picks (onType). Arrow keys,
// Enter and Escape work in the list.
//
// search(q) resolves to the people, or rejects; a rejection with
// `unavailable` set means the directory can't be searched here at all, and
// onUnavailable(message) lets the page fall back to typing the details in.
export default function DirectoryPersonField({
  label, required, value, picked, onType, onPick, search, onUnavailable, unavailable, hint, error
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState(''); // '', 'searching', 'none', 'failed'
  const timer = useRef(null);
  const ticket = useRef(0);
  const listId = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  const lookUp = (q) => {
    clearTimeout(timer.current);
    if (unavailable || q.trim().length < 2) { setResults([]); setOpen(false); setStatus(''); return; }
    const mine = ++ticket.current;
    setStatus('searching'); setOpen(true);
    timer.current = setTimeout(async () => {
      try {
        const people = await search(q.trim());
        if (mine !== ticket.current) return;
        setResults(people); setActive(people.length ? 0 : -1); setStatus(people.length ? '' : 'none');
      } catch (err) {
        if (mine !== ticket.current) return;
        setResults([]);
        if (err?.unavailable) { setOpen(false); setStatus(''); onUnavailable?.(err.message); } else setStatus('failed');
      }
    }, 250);
  };

  const pick = (person) => {
    ticket.current += 1;
    setOpen(false); setResults([]); setStatus('');
    onPick(person);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const message = status === 'searching' ? 'Searching the UCAA directory...'
    : status === 'none' ? `Nobody in the UCAA directory matches “${value.trim()}”.`
      : status === 'failed' ? 'The UCAA directory could not be searched just now. Try again in a moment.' : '';

  return (
    <label style={{ display: 'block', marginBottom: 22, maxWidth: 640, position: 'relative' }}>
      <span style={{ display: 'block', fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
      </span>
      <span style={{ position: 'relative', display: 'block' }}>
        {picked
          ? <UserCheck size={16} aria-hidden style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-success)' }} />
          : <Search size={15} aria-hidden style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-text-muted)' }} />}
        <input
          value={value}
          role="combobox" aria-autocomplete="list" aria-expanded={open && results.length > 0} aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={unavailable ? 'Full name' : 'Start typing a name or email'}
          onChange={(e) => { onType(e.target.value); lookUp(e.target.value); }}
          onFocus={() => { if (results.length) setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          style={{
            display: 'block', width: '100%', padding: '11px 14px 11px 36px', boxSizing: 'border-box',
            border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-sm)',
            fontSize: 'inherit', fontFamily: 'inherit', background: 'var(--color-bg-input)'
          }}
        />
        {open && (results.length > 0 || message) && (
          <span className="ws-suggest" role="presentation">
            {results.length > 0 ? (
              <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
                {results.map((p, i) => (
                  <li key={p.entraObjectId || p.email} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                    className={i === active ? 'on' : undefined}
                    onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
                    <b>{p.name}</b>{p.jobTitle ? <span> · {p.jobTitle}</span> : null}
                    <small>{p.email}{p.department ? ` · ${p.department}` : ''}</small>
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
