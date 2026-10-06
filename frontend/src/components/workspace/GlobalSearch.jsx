import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import staffClient from '../../models/staffApiClient';

// The app bar's search (staff): vacancies by title or job reference, and
// candidates by anything the candidate search matches. Ctrl/Cmd+K focuses
// it; arrows and Enter pick a result. A vacancy opens its page; a candidate
// opens Candidates with the search filled in.
let vacancyCache = null;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const words = q.trim().toLowerCase();
    if (words.length < 2) { setResults(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!vacancyCache) vacancyCache = await staffClient.get('/api/vacancies/admin').then((r) => r.data).catch(() => []);
      const vacancies = vacancyCache
        .filter((v) => `${v.title} ${v.jobRef}`.toLowerCase().includes(words))
        .slice(0, 5)
        .map((v) => ({ kind: 'Vacancy', label: v.title, sub: v.jobRef, go: () => navigate(`/hr/vacancy/${v.id}`) }));
      const candidates = await staffClient.get('/api/talent/candidates', { params: { q: q.trim() } })
        .then((r) => (r.data.data || []).slice(0, 5).map((c) => ({
          kind: 'Candidate', label: c.fullName, sub: c.applications?.[0]?.vacancy?.title || c.email,
          go: () => navigate(`/hr/candidates?q=${encodeURIComponent(c.fullName)}`)
        })))
        .catch(() => []);
      if (!cancelled) { setResults([...vacancies, ...candidates]); setActive(0); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, navigate]);

  const pick = (r) => { r.go(); setQ(''); setResults(null); inputRef.current?.blur(); };
  const onKeyDown = (e) => {
    if (!results?.length) { if (e.key === 'Escape') setQ(''); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
    if (e.key === 'Escape') { setQ(''); setResults(null); }
  };

  return (
    <div className="ws-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setTimeout(() => setResults(null), 150); }}>
      <Search size={16} />
      <input ref={inputRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
        placeholder="Search vacancies, candidates or a job reference" aria-label="Search" autoComplete="off" />
      {results && (
        <div className="ws-results" role="listbox">
          {results.length === 0 && <div className="ws-note">No matches</div>}
          {results.map((r, i) => (
            <button key={`${r.kind}-${r.label}-${i}`} type="button" role="option" aria-selected={i === active}
              className={i === active ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <span className="kind">{r.kind}</span>
              <span>{r.label} <span className="ws-note">{r.sub}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
