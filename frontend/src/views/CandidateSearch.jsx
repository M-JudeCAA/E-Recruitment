import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import HRSidebar from '../components/HRSidebar';
import Alert from '../components/Alert';
import Button from '../components/Button';
import Skeleton from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import PageControls from '../components/PageControls';
import TagEditor, { TagChips } from '../components/TagEditor';
import BulkEmailComposer from '../components/BulkEmailComposer';
import ApplicationQueue from '../components/workspace/ApplicationQueue';
import { PageTop, Panel, Table, SidePanel, KeyValues, rankOf, ROLE_RANK } from '../components/workspace/ui';

// Candidates (/hr/candidates), two views:
//   Candidates   the candidate database (backend talentController;
//                FR-ATS-051/052) - everyone who has applied, past applicants
//                too, searched by keyword and HR's tags; tag them, email a
//                selection. Never erased candidates; each search is access-logged.
//   Applications every application across vacancies, filtered (ApplicationQueue).
// A row opens the person (or the application) in a side panel.
// ?q= pre-fills the search (the app bar's search sends people here).

export default function CandidateSearch() {
  const { staff } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'applications' ? 'applications' : 'candidates';
  const setView = (v) => { const next = new URLSearchParams(params); if (v === 'candidates') next.delete('view'); else next.set('view', v); setParams(next, { replace: true }); };
  const canEmail = rankOf(staff?.role) >= ROLE_RANK.Senior_HR_Officer;

  const [input, setInput] = useState(params.get('q') || '');
  const [q, setQ] = useState(params.get('q') || '');
  const [tagFilter, setTagFilter] = useState([]);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [tags, setTags] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => { const fromUrl = params.get('q') || ''; setInput(fromUrl); setQ(fromUrl); }, [params.get('q')]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadTags = () => staffClient.get('/api/talent/tags').then((r) => setTags(r.data)).catch(() => {});
  useEffect(() => { loadTags(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setQ(input.trim()); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [input]);
  const search = () => staffClient.get('/api/talent/candidates', { params: { q: q || undefined, tags: tagFilter.join(',') || undefined, candidateType: type || undefined, page } })
    .then((r) => setResult(r.data))
    .catch((err) => setError(err.response?.data?.error || 'Could not search'));
  useEffect(() => {
    if (view !== 'candidates') return;
    setResult(null); setError('');
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tagFilter, type, page, view]);

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleTag = (id) => { setTagFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id])); setPage(1); };
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;
  const open = result?.data.find((c) => c.id === openId);
  const background = (c) => [
    ...c.education.map((e) => `${e.qualificationLevelText}${e.fieldOfStudy ? ` in ${e.fieldOfStudy}` : ''}`),
    ...c.workExperience.map((w) => `${w.jobTitle}, ${w.employer}`)
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="candidates" />
      <div className="ws-page" style={{ flex: 1 }}>
        <PageTop title="Candidates" subtitle="Everyone who has applied, including past applicants"
          actions={view === 'candidates' && canEmail && (
            <Button variant="secondary" disabled={!selected.length} onClick={() => setComposing(true)}><Mail size={14} /> Email selected{selected.length ? ` (${selected.length})` : ''}</Button>
          )} />

        <div className="ws-tabs" role="tablist">
          {[['candidates', 'Candidates'], ['applications', 'Applications']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} className={`ws-tab${view === k ? ' on' : ''}`} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>

        {view === 'applications' ? <ApplicationQueue staffRole={staff?.role} /> : (
          <>
            <Alert type="error" message={error} />
            <Alert type="success" message={notice} />
            <div className="ws-toolbar">
              <input className="ws-field grow" style={{ maxWidth: 420 }} placeholder="Name, email, phone, school, course, employer, certificate" aria-label="Search candidates"
                value={input} onChange={(e) => setInput(e.target.value)} />
              <select className="ws-field" aria-label="Candidate type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
                <option value="">Internal and external</option>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
              </select>
              {tags.length > 0 && (
                <div className="ws-chips" role="group" aria-label="Tags">
                  {tags.map((t) => (
                    <button key={t.id} type="button" className={`ws-chip${tagFilter.includes(t.id) ? ' on' : ''}`} aria-pressed={tagFilter.includes(t.id)} onClick={() => toggleTag(t.id)}>
                      {t.name}<b>{t.candidates}</b>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Panel padded={false}>
              {!result && !error ? <div className="ws-panel-b">{[0, 1, 2].map((i) => <Skeleton key={i} height={14} width={`${70 - i * 10}%`} style={{ marginBottom: 12 }} />)}</div> : (
                <Table rows={result?.data || []} getRowKey={(c) => c.id} onRowClick={(c) => setOpenId(c.id)}
                  emptyText={q || tagFilter.length ? 'Nobody matches this search.' : 'Nobody has applied yet.'}
                  columns={[
                    ...(canEmail ? [{
                      key: 'pick', label: '', width: 36,
                      render: (c) => <input type="checkbox" aria-label={`Select ${c.fullName}`} checked={selected.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.id)} />
                    }] : []),
                    { key: 'name', label: 'Candidate', render: (c) => <><span className="t">{c.fullName}</span><div className="s">{c.email}</div></> },
                    {
                      key: 'latest', label: 'Latest application', render: (c) => {
                        const a = c.applications[0];
                        return a ? <>{a.vacancy.title}<div className="s ws-mono">{a.vacancy.jobRef}</div></> : <span className="s">—</span>;
                      }
                    },
                    { key: 'stage', label: 'Status', render: (c) => (c.applications[0] ? <StatusBadge status={c.applications[0].offer?.status === 'Accepted' ? 'Accepted' : c.applications[0].status} /> : null) },
                    { key: 'bg', label: 'Background', render: (c) => <span className="s">{background(c).slice(0, 2).join(' · ') || '—'}</span> },
                    { key: 'tags', label: 'Tags', render: (c) => <TagChips tags={(c.tags || []).map((t) => t.tag || t)} /> }
                  ]} />
              )}
            </Panel>
            {result && <div className="ws-note">{result.total} candidate{result.total === 1 ? '' : 's'}</div>}
            {result && result.total > result.limit && (
              <PageControls page={page} totalPages={totalPages} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
            )}
          </>
        )}
      </div>

      {open && (
        <SidePanel title={open.fullName} eyebrow={open.candidateType} onClose={() => setOpenId(null)}
          footer={canEmail && <Button onClick={() => { setSelected([open.id]); setComposing(true); }}><Mail size={14} /> Email</Button>}>
          <div>
            <h3>Contact</h3>
            <KeyValues rows={[['Email', open.email], ['Phone', open.phone || null], ['Lives in', open.location || null]]} />
          </div>
          <div>
            <h3>Background</h3>
            {background(open).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{background(open).map((b) => <li key={b}>{b}</li>)}</ul> : <span className="ws-note">Nothing recorded.</span>}
          </div>
          <div>
            <h3>Applications</h3>
            <table className="ws-table"><tbody>
              {open.applications.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/hr/vacancy/${a.vacancy.id}?tab=applicants`}>{a.vacancy.title}</Link><div className="s ws-mono">{a.vacancy.jobRef}</div></td>
                  <td className="r"><StatusBadge status={a.offer?.status === 'Accepted' ? 'Accepted' : a.status} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div>
            <h3>Tags</h3>
            <TagEditor candidateId={open.id} tags={open.tags} onChange={() => { loadTags(); search(); }} />
          </div>
        </SidePanel>
      )}

      {composing && (
        <BulkEmailComposer candidateIds={selected} count={selected.length} onClose={() => setComposing(false)}
          onSent={(r) => { setComposing(false); setSelected([]); setNotice(`Email sent to ${r.sent}${r.failed ? `; ${r.failed} could not be sent (${r.failedTo.join(', ')})` : ''}.`); }} />
      )}
    </div>
  );
}
