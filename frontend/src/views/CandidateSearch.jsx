import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Search } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Alert from '../components/Alert';
import Button from '../components/Button';
import TextField from '../components/TextField';
import Select from '../components/Select';
import StatusBadge from '../components/StatusBadge';
import PageControls from '../components/PageControls';
import LoadingState from '../components/LoadingState';
import TagEditor from '../components/TagEditor';
import BulkEmailComposer from '../components/BulkEmailComposer';

// The candidate database (backend talentController; FR-ATS-051/052): search
// everyone who has applied - past applicants too - by keyword and by HR's
// tags, tag them, and email a selection. Only candidates who submitted an
// application are here, never erased ones; each search is access-logged.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function CandidateSearch() {
  const { staff } = useAuth();
  const canEmail = (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [tagFilter, setTagFilter] = useState([]);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [tags, setTags] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');

  const loadTags = () => staffClient.get('/api/talent/tags').then((r) => setTags(r.data)).catch(() => {});
  useEffect(() => { loadTags(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(input.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    setResult(null); setError('');
    staffClient.get('/api/talent/candidates', { params: { q: q || undefined, tags: tagFilter.join(',') || undefined, candidateType: type || undefined, page } })
      .then((r) => setResult(r.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not search'));
  }, [q, tagFilter, type, page]);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleTag = (id) => { setTagFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])); setPage(1); };
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="candidates" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <PageHeader title="Candidates" subtitle="Search everyone who has applied, past applicants included, by keyword and tag" />
        <Alert type="error" message={error} />
        <Alert type="success" message={notice} />
        <Card>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '3 1 280px' }}>
              <TextField label="Keywords" placeholder="Name, email, phone, school, course, employer, job title, certificate..." value={input} onChange={(e) => setInput(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <Select label="Candidate type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
                <option value="">All</option>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
              </Select>
            </div>
          </div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-muted)' }}>Tagged:</span>
              {tags.map((t) => (
                <button key={t.id} type="button" onClick={() => toggleTag(t.id)} aria-pressed={tagFilter.includes(t.id)}
                  style={{ fontSize: 12, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--color-border)',
                    background: tagFilter.includes(t.id) ? 'var(--color-primary)' : 'transparent', color: tagFilter.includes(t.id) ? '#fff' : 'inherit' }}>
                  {t.name} ({t.candidates})
                </button>
              ))}
            </div>
          )}
        </Card>

        {canEmail && selected.length > 0 && (
          <Card style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{selected.length} selected</strong>
            <Button onClick={() => setComposing(true)}><Mail size={14} /> Email selected</Button>
            <Button variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </Card>
        )}

        {!result && !error && <LoadingState label="Searching..." />}
        {result && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}><Search size={13} /> {result.total} candidate(s)</p>
            {result.data.map((c) => (
              <Card key={c.id} style={{ marginBottom: 'var(--spacing-sm)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {canEmail && <input type="checkbox" aria-label={`Select ${c.fullName}`} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} style={{ marginTop: 4 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <strong>{c.fullName}</strong>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.candidateType} &middot; {c.email}{c.phone ? ` · ${c.phone}` : ''}{c.location ? ` · ${c.location}` : ''}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '4px 0' }}>
                      {[...c.education.map((e) => `${e.qualificationLevelText}${e.fieldOfStudy ? ` in ${e.fieldOfStudy}` : ''}`), ...c.workExperience.map((w) => `${w.jobTitle}, ${w.employer}`)].join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12, marginBottom: 6 }}>
                      {c.applications.map((a) => (
                        <Link key={a.id} to={`/hr/applications?vacancyId=${a.vacancy.id}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {a.vacancy.jobRef} <StatusBadge status={a.offer?.status === 'Accepted' ? 'Accepted' : a.status} />
                        </Link>
                      ))}
                    </div>
                    <TagEditor candidateId={c.id} tags={c.tags} onChange={loadTags} />
                  </div>
                </div>
              </Card>
            ))}
            <PageControls page={page} totalPages={totalPages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </>
        )}

        {composing && (
          <BulkEmailComposer candidateIds={selected} count={selected.length} onClose={() => setComposing(false)}
            onSent={(r) => { setComposing(false); setSelected([]); setNotice(`Email sent to ${r.sent}${r.failed ? `; ${r.failed} could not be sent (${r.failedTo.join(', ')})` : ''}.`); }} />
        )}
      </div>
    </div>
  );
}
