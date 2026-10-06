import React, { useCallback, useEffect, useState } from 'react';
import { Users, Crown, Trash2, Plus, Send, Link2, ChevronDown, ChevronUp, Gavel, Lock, ListChecks, ShieldCheck, Undo2 } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import Alert from './Alert';
import StatusBadge from './StatusBadge';
import LoadingState from './LoadingState';
import { useConfirm } from './ConfirmDialog';
import ReasonDialog from './ReasonDialog';
import { inputStyle, sectionLabel, hintText, chipStyle } from './interviews/formStyles';
import { BAND_LABELS, STAGE_LABELS, ratingLabel } from '../utils/shortlistCommittee';

// HR's side of a vacancy's shortlisting committee (backend
// shortlistCommitteeController.js). Setup: the assessment sheet (generated
// from the vacancy's requirements, editable) and the committee - anyone at
// UCAA, one chair - nominated by HR and approved by the DHRA (a Director),
// who may change the members first. Rating: members rate through their private links, blind
// to each other; HR sees progress only. Moderation: the ranking appears and
// the chair settles disputed items. Closed: HR proposes the interview
// shortlist strictly from the top of the committee's order - no reordering -
// and a Principal HR Officer approves it as before.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

const errorOf = (err, fallback) => err.response?.data?.error || fallback;

function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CriteriaEditor({ criteria, onSave, saving }) {
  const [rows, setRows] = useState(criteria);
  useEffect(() => setRows(criteria), [criteria]);
  const set = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(criteria);

  return (
    <div style={{ marginBottom: 16 }}>
      <span style={sectionLabel}>Assessment sheet</span>
      <p style={{ ...hintText, marginTop: 0 }}>
        Built from the vacancy's requirements. Essential criteria are rated Met / Partly met / Not met and decide who qualifies;
        desirable criteria are rated 1-5 and separate the qualified. The weight (1-5) sets how much each counts in the score.
        The sheet locks when rating opens.
      </p>
      {rows.map((c, i) => (
        <div key={c.id || i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
          <select aria-label="Kind" value={c.kind} onChange={(e) => set(i, { kind: e.target.value })} style={{ ...inputStyle, width: 120 }}>
            <option value="Essential">Essential</option>
            <option value="Desirable">Desirable</option>
          </select>
          <input aria-label="Criterion" value={c.label} onChange={(e) => set(i, { label: e.target.value })} style={{ ...inputStyle, flex: '1 1 260px' }} />
          <select aria-label="Weight" value={c.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })} style={{ ...inputStyle, width: 90 }}>
            {[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>Weight {w}</option>)}
          </select>
          {c.autoKey && <span style={hintText} title="Raters see the automated check for this criterion">system check</span>}
          <button type="button" aria-label="Remove criterion" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="ghost" onClick={() => setRows([...rows, { kind: 'Essential', label: '', weight: 1 }])}><Plus size={14} /> Add criterion</Button>
        <Button onClick={() => onSave(rows)} disabled={!dirty} loading={saving} loadingText="Saving...">Save sheet</Button>
      </div>
    </div>
  );
}

function MembersEditor({ members, editable, onAdd, onRemove, onMakeChair, onReissue, busy }) {
  const blank = { name: '', email: '', isChair: false, external: false, externalReason: '' };
  const [form, setForm] = useState(blank);
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={sectionLabel}>Committee</span>
      <p style={{ ...hintText, marginTop: 0 }}>
        Anyone at UCAA, HR included - but not an applicant for this vacancy. Someone from outside UCAA only as a special case,
        with the reason. One member chairs: at moderation the chair rules on the items the committee disagreed on. The chair can
        be changed until the exercise closes.
      </p>
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 200px', minWidth: 0 }}>
            <strong>{m.name}</strong> {m.isChair && <span style={{ ...hintText, color: 'var(--color-gold-dark)' }}><Crown size={12} /> chair</span>}
            <span style={{ display: 'block', ...hintText }}>{m.email}</span>
            {m.externalReason && <span style={{ display: 'block', ...hintText }}><strong>From outside UCAA:</strong> {m.externalReason}</span>}
          </span>
          {m.assigned != null && m.assigned > 0 && (
            <span style={hintText}>
              {m.completed}/{m.assigned} rated{m.conflicts ? ` · ${m.conflicts} conflict${m.conflicts === 1 ? '' : 's'}` : ''}
              {' · '}{m.submittedAt ? <strong style={{ color: 'var(--color-accent)' }}>submitted</strong> : 'not submitted'}
            </span>
          )}
          {!m.isChair && onMakeChair && <button type="button" style={chipStyle(false)} onClick={() => onMakeChair(m)} disabled={busy}><Crown size={12} /> Make chair</button>}
          {onReissue && <button type="button" style={chipStyle(false)} onClick={() => onReissue(m)} disabled={busy}><Link2 size={12} /> New link</button>}
          {editable && <button type="button" style={{ ...chipStyle(false), color: 'var(--color-danger)' }} onClick={() => onRemove(m)} disabled={busy}><Trash2 size={12} /> Remove</button>}
        </div>
      ))}
      {editable && (
        <form onSubmit={(e) => {
          e.preventDefault();
          const { external, ...body } = form;
          onAdd(external ? body : { ...body, externalReason: undefined }).then((ok) => ok && setForm(blank));
        }}
          style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <input aria-label="Name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inputStyle, flex: '1 1 160px' }} />
          <input aria-label="Email" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ ...inputStyle, flex: '1 1 200px' }} />
          <label style={{ ...hintText, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={form.isChair} onChange={(e) => setForm({ ...form, isChair: e.target.checked })} /> Chair
          </label>
          <label style={{ ...hintText, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={form.external} onChange={(e) => setForm({ ...form, external: e.target.checked })} /> From outside UCAA
          </label>
          {form.external && (
            <input aria-label="Why someone from outside UCAA is needed" placeholder="Why someone from outside UCAA is needed (special case)"
              value={form.externalReason} onChange={(e) => setForm({ ...form, externalReason: e.target.value })} style={{ ...inputStyle, flex: '1 1 100%' }} />
          )}
          <Button type="submit" variant="secondary" disabled={busy}><Plus size={14} /> Add member</Button>
        </form>
      )}
    </div>
  );
}

// Rating: applicants left with fewer than two raters who can still rate
// them (members stood down) - HR adds another member to each.
function CoverageList({ coverage, onAdd, busy }) {
  const [picked, setPicked] = useState({});
  if (!coverage?.length) return null;
  return (
    <div style={{ background: 'var(--color-warning-light)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 12 }}>
      <span style={sectionLabel}>Applicants who need another rater</span>
      <p style={{ ...hintText, marginTop: 0 }}>Members stood down from these applicants, leaving fewer than two to rate them. Add another member - they are emailed.</p>
      {coverage.map((c) => (
        <div key={c.applicationId} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
          <strong style={{ fontSize: 14, flex: '1 1 180px' }}>{c.candidateName}</strong>
          <span style={{ ...hintText, flex: '1 1 220px' }}>{c.raters.map((r) => `${r.name}${r.conflict ? ' (stood down)' : ''}`).join(', ')}</span>
          {c.available.length ? (
            <>
              <select aria-label={`Add a rater for ${c.candidateName}`} value={picked[c.applicationId] || ''} style={{ ...inputStyle, width: 180 }}
                onChange={(e) => setPicked({ ...picked, [c.applicationId]: e.target.value })}>
                <option value="">Choose a member</option>
                {c.available.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button type="button" style={chipStyle(true)} disabled={busy || !picked[c.applicationId]}
                onClick={() => onAdd(c, Number(picked[c.applicationId]))}><Plus size={12} /> Add rater</button>
            </>
          ) : <span style={hintText}>Every other member has submitted - the chair will rule on this applicant at moderation.</span>}
        </div>
      ))}
    </div>
  );
}

function ResultsTable({ exercise, canEdit, onActingChair, busy }) {
  const [open, setOpen] = useState(null);
  const criteria = exercise.criteria;
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', marginBottom: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: 'var(--color-bg-subtle)', textAlign: 'left' }}>
            {['Rank', 'Applicant', 'Committee view', 'Score', 'Agreement', 'Raters', ''].map((h) => <th key={h} style={{ padding: '8px 10px', fontWeight: 600 }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {exercise.results.map((r) => (
            <React.Fragment key={r.applicationId}>
              <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{['Unanimous', 'Majority'].includes(r.band) ? r.rank : '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.candidateName}</td>
                <td style={{ padding: '8px 10px' }}>
                  <StatusBadge status={r.band} label={BAND_LABELS[r.band]} />
                  {r.disputed.length > 0 && <span style={{ ...hintText, marginLeft: 6 }}>{r.disputed.length} to settle</span>}
                  {r.chairConflicted && r.band === 'Disputed' && exercise.status === 'Moderation' && (
                    <div style={{ ...hintText, marginTop: 4 }}>
                      Chair stood down.{' '}
                      {canEdit ? (
                        <select aria-label={`Acting chair for ${r.candidateName}`} value={r.actingChair?.memberId || ''} disabled={busy}
                          onChange={(e) => onActingChair(r, e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, padding: '2px 6px', fontSize: 12 }}>
                          <option value="">Name an acting chair...</option>
                          {exercise.members.filter((m) => !m.isChair && !r.raters.some((x) => x.memberId === m.id && x.conflict))
                            .map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      ) : (r.actingChair ? `Acting chair: ${r.actingChair.name}` : 'No acting chair yet')}
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.score}</td>
                <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{Math.round(r.agreement * 100)}%</td>
                <td style={{ padding: '8px 10px' }}>{r.raterCount}</td>
                <td style={{ padding: '8px 10px' }}>
                  <button type="button" aria-label={open === r.applicationId ? 'Hide ratings' : 'Show ratings'} onClick={() => setOpen(open === r.applicationId ? null : r.applicationId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}>{open === r.applicationId ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                </td>
              </tr>
              {open === r.applicationId && (
                <tr>
                  <td colSpan={7} style={{ padding: '4px 10px 12px', background: 'var(--color-bg-subtle)' }}>
                    {criteria.map((c) => {
                      const result = r.criteria.find((x) => x.id === c.id);
                      return (
                        <div key={c.id} style={{ fontSize: 13, padding: '4px 0' }}>
                          <strong>{c.label}</strong> <span style={hintText}>({c.kind})</span>
                          {c.kind === 'Essential' && <> · {result.outcome === 'Disputed' ? <strong style={{ color: 'var(--color-warning)' }}>Disputed</strong> : result.outcome === 'Met' ? 'Met' : 'Not met'}{result.decidedByChair ? ' (chair\'s ruling)' : result.unanimous ? ' (unanimous)' : ''}</>}
                          {c.kind === 'Desirable' && result.average != null && <> · average {result.average}/5</>}
                          <div style={hintText}>
                            {r.raters.filter((x) => x.submitted).map((x) => (x.conflict
                              ? `${x.name}: stood down (${x.conflictReason})`
                              : `${x.name}: ${ratingLabel(c, x.ratings[c.id]?.value)}${x.ratings[c.id]?.comment ? ` - "${x.ratings[c.id].comment}"` : ''}`)).join(' · ')}
                          </div>
                        </div>
                      );
                    })}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NOMINATION_TEXT = {
  Draft: 'Not yet sent to the DHRA.',
  Submitted: 'With the DHRA for approval.',
  Approved: 'Approved by the DHRA.',
  Returned: 'Returned by the DHRA.'
};

// The nomination (FR-ATS-046): HR submits the members; the DHRA approves,
// returns them with a reason, or changes them first.
function NominationPanel({ exercise, canEdit, isDhra, busy, onSubmit, onApprove, onReturn }) {
  const s = exercise.nominationStatus;
  const when = (d) => (d ? new Date(d).toLocaleString() : '');
  const tone = s === 'Approved' ? 'var(--color-accent)' : s === 'Returned' ? 'var(--color-danger)' : s === 'Submitted' ? 'var(--color-warning)' : 'var(--color-border)';
  return (
    <div style={{ border: `1px solid ${tone}`, borderLeftWidth: 4, borderRadius: 'var(--radius-sm)', padding: '10px 12px', margin: '12px 0' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ShieldCheck size={16} /> <strong>Committee approval</strong>
        <span style={{ fontSize: 13 }}>{NOMINATION_TEXT[s]}</span>
      </div>
      <div style={{ ...hintText, marginTop: 4 }}>
        {exercise.nominationSubmittedAt && `Submitted ${when(exercise.nominationSubmittedAt)}${exercise.nominationSubmittedBy ? ` by ${exercise.nominationSubmittedBy.name}` : ''}. `}
        {exercise.nominationDecidedAt && `${s === 'Returned' ? 'Returned' : 'Approved'} ${when(exercise.nominationDecidedAt)}${exercise.nominationDecidedBy ? ` by ${exercise.nominationDecidedBy.name}` : ''}.`}
        {s === 'Submitted' && (isDhra ? ' You can change the members below before approving - every change is recorded.' : ' Members can\'t be changed while it is with the DHRA.')}
        {s === 'Approved' && ' Changing the members now sends the committee back for approval.'}
      </div>
      {s === 'Returned' && exercise.nominationReturnReason && (
        <div style={{ fontSize: 13, marginTop: 4 }}><strong>DHRA's reason:</strong> {exercise.nominationReturnReason}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {canEdit && ['Draft', 'Returned'].includes(s) && (
          <Button onClick={onSubmit} loading={busy}><Send size={14} /> Submit to the DHRA for approval</Button>
        )}
        {isDhra && s === 'Submitted' && (
          <>
            <Button onClick={onApprove} loading={busy}><ShieldCheck size={14} /> Approve committee</Button>
            <Button variant="ghost" onClick={onReturn} disabled={busy}><Undo2 size={14} /> Return to HR</Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ShortlistCommittee({ vacancy, staffRole, onChanged, onManagedChange, reloadKey }) {
  const confirm = useConfirm();
  const canEdit = (ROLE_RANK[staffRole] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const isDhra = (ROLE_RANK[staffRole] || 0) >= ROLE_RANK.Director;
  const [returning, setReturning] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState([]);
  const [count, setCount] = useState('');

  const base = `/api/shortlist-committee/vacancies/${vacancy.id}`;
  const load = useCallback(() => staffClient.get(base)
    .then((res) => { setData(res.data); onManagedChange?.(Boolean(res.data.exercise)); })
    .catch((err) => setError(errorOf(err, 'Could not load the shortlisting committee'))), [base, onManagedChange]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const run = async (request, success) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await request();
      if (res?.data?.exercise !== undefined) setData(res.data); else await load();
      if (success) setMessage(typeof success === 'function' ? success(res.data) : success);
      onChanged?.();
      return res?.data || true;
    } catch (err) {
      setError(errorOf(err, 'That did not work - please try again'));
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <Alert type="error" message={error} /> : <LoadingState label="Loading the shortlisting committee..." />;
  const { exercise } = data;

  if (!exercise) {
    return (
      <Card accent="var(--color-primary)">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Users size={22} color="var(--color-primary)" />
          <div style={{ flex: 1, minWidth: 240 }}>
            <strong>Shortlisting committee</strong>
            <p style={{ ...hintText, fontSize: 13 }}>
              A committee of UCAA staff rates every screened applicant ({data.poolCount} now) against the job's requirements. The
              system ranks them by how the committee agrees, and the interview shortlist is taken from the top - it can't be
              reordered by hand.
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => run(() => staffClient.post(base), 'Committee set up - review the assessment sheet and invite the members.')} loading={busy}>
              <Users size={16} /> Set up committee
            </Button>
          )}
        </div>
        <Alert type="error" message={error} />
      </Card>
    );
  }

  const stage = exercise.status;
  const qualified = (exercise.results || []).filter((r) => ['Unanimous', 'Majority'].includes(r.band)).length;

  const saveCriteria = (criteria) => run(() => staffClient.patch(base, { criteria }), 'Assessment sheet saved.');
  const addMember = async (form) => Boolean(await run(() => staffClient.post(`${base}/members`, form), `${form.name} added.`));
  const removeMember = async (m) => {
    if (await confirm(`Remove ${m.name} from the committee?`, { title: 'Remove member', confirmLabel: 'Remove', danger: true })) {
      run(() => staffClient.delete(`${base}/members/${m.id}`));
    }
  };
  const makeChair = (m) => run(() => staffClient.patch(`${base}/members/${m.id}`, { isChair: true }), `${m.name} now chairs the committee.`);
  const reissue = async (m) => {
    if (!(await confirm(`Send ${m.name} a new link? Their current link stops working.`, { title: 'New link', confirmLabel: 'Send new link' }))) return;
    const result = await run(() => staffClient.post(`${base}/members/${m.id}/link`), (d) => (d.emailed ? `New link emailed to ${m.name}.` : `Couldn't email ${m.name} - share the link below.`));
    if (result && !result.emailed) setLinks([{ name: m.name, url: result.url }]);
  };
  const addRater = (c, memberId) => run(() => staffClient.post(`${base}/assignments`, { memberId, applicationId: c.applicationId }),
    `Rater added for ${c.candidateName} and emailed.`);
  const setActingChair = (row, memberId) => run(() => staffClient.put(`${base}/acting-chairs`, { applicationId: row.applicationId, memberId }),
    memberId ? `Acting chair named for ${row.candidateName} and emailed.` : `Acting chair cleared for ${row.candidateName}.`);
  const openRating = async () => {
    if (!(await confirm('Open rating? The assessment sheet locks, applicants are assigned, and every member is emailed their private link.', { title: 'Open rating', confirmLabel: 'Open rating' }))) return;
    const result = await run(() => staffClient.post(`${base}/open`), (d) => `Rating is open: ${d.applicants} applicants, ${d.assignments} assignments.`);
    if (result?.links) setLinks(result.links.filter((l) => !l.emailed));
  };
  const submitNomination = async () => {
    if (!(await confirm('Send the committee to the DHRA for approval? The members can\'t be changed by HR while it is with them.', { title: 'Submit for approval', confirmLabel: 'Submit' }))) return;
    run(() => staffClient.post(`${base}/nomination/submit`), 'Sent to the DHRA for approval.');
  };
  const approveNomination = async () => {
    if (!(await confirm('Approve this shortlisting committee? HR can then open rating and the members get their links.', { title: 'Approve committee', confirmLabel: 'Approve' }))) return;
    run(() => staffClient.post(`${base}/nomination/approve`), 'Committee approved.');
  };
  const accessEnd = (
    <label style={hintText}>Members' access ends (optional - it always ends when the exercise closes)
      <input type="datetime-local" defaultValue={toLocalInput(exercise.accessExpiresAt)} style={{ ...inputStyle, display: 'block' }} disabled={!canEdit}
        onBlur={(e) => run(() => staffClient.patch(base, { accessExpiresAt: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
    </label>
  );
  const startModeration = async (force = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await staffClient.post(`${base}/moderation`, { force });
      setData(res.data);
      setMessage('Rating closed. The chair has been sent the disputed items to rule on.');
      onChanged?.();
    } catch (err) {
      if (err.response?.data?.code === 'MEMBERS_NOT_SUBMITTED') {
        setBusy(false);
        if (await confirm(`${err.response.data.error}. Close rating anyway?`, { title: 'Members still rating', confirmLabel: 'Close rating', danger: true })) startModeration(true);
        return;
      }
      setError(errorOf(err, 'Could not close rating'));
    } finally {
      setBusy(false);
    }
  };
  const closeExercise = async () => {
    if (await confirm('Close the exercise? The committee\'s ranking becomes final and the interview shortlist can then be proposed from it.', { title: 'Close exercise', confirmLabel: 'Close exercise' })) {
      run(() => staffClient.post(`${base}/close`), 'Exercise closed - the ranking is final.');
    }
  };
  // The server takes strictly the top N qualified, at least the number of posts.
  const minCount = Math.min(vacancy.positionsRequired, qualified);
  const countValid = Number.isInteger(Number(count)) && Number(count) >= Math.max(1, minCount) && Number(count) <= qualified;

  const propose = async () => {
    const n = Number(count);
    if (!(await confirm(`Propose the top ${n} for interview (plus anyone tied with the last)? A Principal HR Officer then approves it.`, { title: 'Propose interview shortlist', confirmLabel: 'Propose' }))) return;
    run(() => staffClient.post(`${base}/propose`, { count: n }), (d) => `${d.proposed} candidate(s) proposed for interview - awaiting approval.`);
  };

  return (
    <Card accent="var(--color-primary)">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Users size={18} /> Shortlisting committee</strong>
        <StatusBadge status={stage} label={STAGE_LABELS[stage]} />
      </div>
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      {links.length > 0 && (
        <div style={{ background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginBottom: 12 }}>
          <span style={sectionLabel}>Links to share by hand (private to each member)</span>
          {links.map((l) => (
            <div key={l.url} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 13, width: 140, flexShrink: 0 }}>{l.name}</span>
              <input readOnly value={l.url} onFocus={(e) => e.target.select()} style={{ ...inputStyle, flex: 1, fontSize: 12 }} aria-label={`Link for ${l.name}`} />
            </div>
          ))}
        </div>
      )}

      {stage === 'Setup' && (
        <>
          {canEdit ? <CriteriaEditor criteria={exercise.criteria} onSave={saveCriteria} saving={busy} /> : (
            <p style={hintText}>{exercise.criteria.length} criteria on the assessment sheet.</p>
          )}
          {canEdit && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
              <label style={hintText}>Raters per applicant
                <input type="number" min="3" max="15" defaultValue={exercise.ratersPerApplicant} style={{ ...inputStyle, display: 'block', width: 90 }}
                  onBlur={(e) => Number(e.target.value) !== exercise.ratersPerApplicant && run(() => staffClient.patch(base, { ratersPerApplicant: Number(e.target.value) }))} />
              </label>
              <label style={hintText}>Calibration set (rated by everyone)
                <input type="number" min="0" max="50" defaultValue={exercise.calibrationCount} style={{ ...inputStyle, display: 'block', width: 90 }}
                  onBlur={(e) => Number(e.target.value) !== exercise.calibrationCount && run(() => staffClient.patch(base, { calibrationCount: Number(e.target.value) }))} />
              </label>
              <label style={hintText}>Rating deadline (optional)
                <input type="datetime-local" defaultValue={toLocalInput(exercise.ratingDeadline)} style={{ ...inputStyle, display: 'block' }}
                  onBlur={(e) => run(() => staffClient.patch(base, { ratingDeadline: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
              </label>
              <span style={{ ...hintText, flex: '1 1 220px' }}>
                With more members than raters per applicant, each applicant goes to a sub-panel, after a calibration set everyone rates.
              </span>
            </div>
          )}
          {(() => {
            const membersEditable = exercise.nominationStatus === 'Submitted' ? isDhra : canEdit;
            return (
              <MembersEditor members={exercise.members} editable={membersEditable} busy={busy}
                onAdd={addMember} onRemove={removeMember} onMakeChair={membersEditable ? makeChair : null} />
            );
          })()}
          <NominationPanel exercise={exercise} canEdit={canEdit} isDhra={isDhra} busy={busy}
            onSubmit={submitNomination} onApprove={approveNomination} onReturn={() => setReturning(true)} />
          {canEdit && <div style={{ marginBottom: 12 }}>{accessEnd}</div>}
          {canEdit && exercise.nominationStatus === 'Approved' && (
            <Button onClick={openRating} loading={busy} loadingText="Opening...">
              <Send size={16} /> Open rating ({data.poolCount} applicants)
            </Button>
          )}
          {returning && (
            <ReasonDialog title="Return the committee to HR" intro="HR will see your reason and can change the members and submit again."
              confirmLabel="Return" onClose={() => setReturning(false)}
              onSubmit={async (reason) => {
                const res = await staffClient.post(`${base}/nomination/return`, { reason });
                setData(res.data); setReturning(false); setMessage('Committee returned to HR.'); onChanged?.();
              }} />
          )}
        </>
      )}

      {stage === 'Rating' && (
        <>
          <p style={{ ...hintText, fontSize: 13 }}>
            Members are rating through their private links, blind to each other. You'll see the ranking once rating closes.
            {exercise.ratingDeadline && ` Deadline: ${new Date(exercise.ratingDeadline).toLocaleString()}.`}
          </p>
          <MembersEditor members={exercise.members} editable={false} busy={busy}
            onMakeChair={canEdit ? makeChair : null} onReissue={canEdit ? reissue : null} />
          {canEdit && <CoverageList coverage={exercise.coverage} onAdd={addRater} busy={busy} />}
          {canEdit && <div style={{ margin: '12px 0' }}>{accessEnd}</div>}
          {canEdit && (
            <Button onClick={() => startModeration(false)} loading={busy}>
              <Lock size={16} /> Close rating and start moderation
            </Button>
          )}
        </>
      )}

      {(stage === 'Moderation' || stage === 'Closed') && (
        <>
          {stage === 'Moderation' && (
            <>
              <p style={{ ...hintText, fontSize: 13 }}>
                {exercise.disputedCount > 0
                  ? `${exercise.disputedCount} applicant(s) have essential criteria the committee couldn't agree on, or too few raters. The chair rules on them from their link (or an acting chair you name, where the chair stood down); the ranking updates as they do.`
                  : 'Nothing is in dispute. Close the exercise to make the ranking final.'}
              </p>
              <MembersEditor members={exercise.members} editable={false} busy={busy}
                onMakeChair={canEdit ? makeChair : null} onReissue={canEdit ? reissue : null} />
            </>
          )}
          <ResultsTable exercise={exercise} canEdit={canEdit} onActingChair={setActingChair} busy={busy} />
          {stage === 'Moderation' && canEdit && (
            <Button onClick={closeExercise} loading={busy} disabled={exercise.disputedCount > 0}>
              <Gavel size={16} /> Close exercise
            </Button>
          )}
          {stage === 'Closed' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {exercise.approvedCount > 0 ? (
                <Alert type="success" message="The interview shortlist from this ranking has been approved." />
              ) : (
                <>
                  <span style={{ ...hintText, flex: '1 1 260px' }}>
                    {qualified} qualified. {exercise.proposedCount > 0 && `${exercise.proposedCount} currently proposed for interview, awaiting approval. `}
                    Choose how many to interview - at least the {vacancy.positionsRequired} post(s). They are taken strictly from the top.
                  </span>
                  {canEdit && (
                    <>
                      <input type="number" min={Math.min(vacancy.positionsRequired, qualified)} max={qualified} value={count}
                        onChange={(e) => setCount(e.target.value)} placeholder={String(Math.min(qualified, vacancy.positionsRequired * 3))}
                        aria-label="How many to interview" style={{ ...inputStyle, width: 100 }} />
                      <Button onClick={propose} loading={busy} disabled={!countValid}>
                        <ListChecks size={16} /> Propose for interview
                      </Button>
                      {count && !countValid && (
                        <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)', flexBasis: '100%' }}>
                          Enter a whole number from {minCount} to {qualified}.
                        </span>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
