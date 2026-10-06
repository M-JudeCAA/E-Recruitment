import React, { useEffect, useState } from 'react';
import { Tag, X, Plus } from 'lucide-react';
import staffClient from '../models/staffApiClient';

// HR's tags on a candidate (backend talentController; FR-ATS-051), e.g.
// "Qualified" or "ATM trainees" - they follow the candidate across
// vacancies and can be searched on. Type to pick an existing tag or make a
// new one. `tags` is [{ id, name }].

let tagCache = null;
async function allTags(refresh) {
  if (!tagCache || refresh) tagCache = staffClient.get('/api/talent/tags').then((r) => r.data).catch(() => []);
  return tagCache;
}

const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' };

export function TagChips({ tags }) {
  if (!tags?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((t) => <span key={t.id} style={chip}><Tag size={10} /> {t.name}</span>)}
    </span>
  );
}

export default function TagEditor({ candidateId, tags: initial, onChange, editable = true }) {
  const [tags, setTags] = useState(initial || []);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { setTags(initial || []); }, [initial]);
  useEffect(() => { if (adding) allTags().then(setOptions); }, [adding]);

  const save = async (request) => {
    setError('');
    try {
      const res = await request();
      setTags(res.data); onChange?.(res.data);
      allTags(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change the tags');
    }
  };
  const add = (body) => { setAdding(false); setText(''); save(() => staffClient.post(`/api/talent/candidates/${candidateId}/tags`, body)); };
  const matches = options.filter((o) => !tags.some((t) => t.id === o.id) && o.name.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 6);

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {tags.map((t) => (
        <span key={t.id} style={chip}>
          <Tag size={10} /> {t.name}
          {editable && (
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => save(() => staffClient.delete(`/api/talent/candidates/${candidateId}/tags/${t.id}`))}
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}><X size={11} /></button>
          )}
        </span>
      ))}
      {editable && !adding && (
        <button type="button" onClick={() => setAdding(true)} style={{ ...chip, cursor: 'pointer', background: 'transparent' }}><Plus size={11} /> Tag</button>
      )}
      {adding && (
        <span style={{ position: 'relative' }}>
          <input autoFocus value={text} placeholder="Tag name" aria-label="Tag name" maxLength={60}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim().length >= 2) { e.preventDefault(); add(matches.find((m) => m.name.toLowerCase() === text.trim().toLowerCase()) ? { tagId: matches[0].id } : { name: text }); }
              if (e.key === 'Escape') { setAdding(false); setText(''); }
            }}
            onBlur={() => setTimeout(() => setAdding(false), 150)}
            style={{ fontSize: 12, padding: '2px 6px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', width: 140 }} />
          {(matches.length > 0 || text.trim().length >= 2) && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
              {matches.map((m) => (
                <button key={m.id} type="button" onMouseDown={(e) => { e.preventDefault(); add({ tagId: m.id }); }}
                  style={{ all: 'unset', display: 'block', padding: '4px 8px', fontSize: 12, cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}>{m.name}</button>
              ))}
              {text.trim().length >= 2 && !matches.some((m) => m.name.toLowerCase() === text.trim().toLowerCase()) && (
                <button type="button" onMouseDown={(e) => { e.preventDefault(); add({ name: text }); }}
                  style={{ all: 'unset', display: 'block', padding: '4px 8px', fontSize: 12, cursor: 'pointer', color: 'var(--color-primary)' }}>New tag "{text.trim()}"</button>
              )}
            </div>
          )}
        </span>
      )}
      {error && <span style={{ color: 'var(--color-danger)', fontSize: 11 }}>{error}</span>}
    </div>
  );
}
