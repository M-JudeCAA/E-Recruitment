import React, { useEffect, useRef, useState } from 'react';
import { Search, UserCheck, X } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { isEntraConfigured, searchStaffDirectory } from '../models/entraAuth';
import TextField from './TextField';
import Button from './Button';

// The vacancy's hiring manager: a UCAA employee, picked from the staff
// directory - searched in the browser with the HR user's own Microsoft Graph
// permission (models/entraAuth.js), else through the API's app permission
// (GET /api/directory/people) - or, if neither works, typed in by name and
// UCAA email. They are
// kept up to date by email (backend hiringManagerService); no system access.
// value: { name, email, entraObjectId?, jobTitle? } or null.

const inputStyle = {
  width: '100%', padding: '10px 12px 10px 32px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  fontSize: 14, fontFamily: 'inherit', background: 'var(--color-bg-input)', boxSizing: 'border-box'
};

export default function HiringManagerPicker({ value, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [manual, setManual] = useState(false); // directory not connected
  const [message, setMessage] = useState('');
  const [typed, setTyped] = useState({ name: '', email: '' });
  const latest = useRef(0);

  useEffect(() => {
    if (manual || query.trim().length < 2) { setResults([]); return undefined; }
    const ticket = ++latest.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        let people = null;
        if (isEntraConfigured('staff')) {
          try {
            people = await searchStaffDirectory(query.trim());
          } catch (err) {
            console.warn('Directory search in the browser failed, trying the API:', err.message);
          }
        }
        if (!people) people = (await staffClient.get('/api/directory/people', { params: { q: query.trim() } })).data;
        if (ticket === latest.current) { setResults(people); setMessage(people.length ? '' : 'Nobody in the directory matches that.'); }
      } catch (err) {
        if (['DIRECTORY_NOT_CONFIGURED', 'DIRECTORY_UNAVAILABLE'].includes(err.response?.data?.code)) {
          setManual(true);
          setMessage(err.response.data.error);
        } else {
          setMessage(err.response?.data?.error || 'Could not search the directory');
        }
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, manual]);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <UserCheck size={18} color="var(--color-accent)" />
          <span>
            <strong>{value.name}</strong>{value.jobTitle ? <span style={{ color: 'var(--color-text-muted)' }}> · {value.jobTitle}</span> : null}
            <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>{value.email}</span>
          </span>
        </span>
        {!disabled && (
          <Button type="button" variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => { onChange(null); setQuery(''); }}>
            <X size={14} /> Change
          </Button>
        )}
      </div>
    );
  }

  if (manual) {
    return (
      <div>
        {message && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>{message}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <TextField label="Hiring manager's name" value={typed.name} disabled={disabled} onChange={(e) => setTyped({ ...typed, name: e.target.value })} />
          <TextField label="Their UCAA email" type="email" value={typed.email} disabled={disabled} onChange={(e) => setTyped({ ...typed, email: e.target.value })} />
        </div>
        <Button type="button" variant="secondary" disabled={disabled || typed.name.trim().length < 2 || !typed.email.includes('@')}
          onClick={() => onChange({ name: typed.name.trim(), email: typed.email.trim().toLowerCase() })} style={{ marginBottom: 16 }}>
          Use this person
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--color-text-muted)' }} />
        <input aria-label="Search the staff directory for the hiring manager" placeholder="Search UCAA staff by name or email"
          value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} style={inputStyle} />
      </div>
      {searching && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>Searching...</p>}
      {!searching && message && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>{message}</p>}
      {results.length > 0 && (
        <ul role="listbox" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', maxHeight: 260, overflowY: 'auto' }}>
          {results.map((p) => (
            <li key={p.entraObjectId}>
              <button type="button" role="option" aria-selected="false" onClick={() => onChange(p)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
                <strong>{p.name}</strong>{p.jobTitle ? ` · ${p.jobTitle}` : ''}
                <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)' }}>{p.email}{p.department ? ` · ${p.department}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
