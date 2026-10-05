import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, Paperclip, Crown, Gavel } from 'lucide-react';
import client, { API_URL } from '../models/apiClient';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import TextArea from '../components/TextArea';
import Skeleton from '../components/Skeleton';
import StatusBadge from '../components/StatusBadge';
import { useConfirm } from '../components/ConfirmDialog';
import { ESSENTIAL_OPTIONS, DESIRABLE_LABELS, ratingLabel } from '../utils/shortlistCommittee';

// Public page - a shortlisting committee member's private link (no account;
// committee members are never HR staff). They rate each applicant assigned
// to them on the vacancy's criteria - essential ones Met / Partly met / Not
// met, desirable ones 1-5 - blind to the rest of the committee, and can
// change any rating until they submit. At moderation the chair also gets the
// disputed items, with every rater's view, to rule on. See backend
// shortlistPanelController.js.

const muted = { fontSize: 13, color: 'var(--color-text-muted)' };
const choice = (active) => ({
  padding: '6px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
  background: active ? 'var(--color-primary)' : 'var(--color-bg)', color: active ? '#fff' : 'var(--color-text)'
});

const yearOf = (d) => (d ? new Date(d).getFullYear() : null);

function Profile({ applicant }) {
  const c = applicant.candidate;
  const section = (title, items) => items.length > 0 && (
    <div style={{ marginBottom: 12 }}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  );
  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>{c.fullName}</h3>
      <p style={muted}>{c.candidateType} applicant{c.location ? ` · ${c.location}` : ''}{c.flyingHours != null ? ` · ${c.flyingHours} flying hours` : ''}</p>
      {section('Education', (c.education || []).map((e) => `${e.qualificationLevel || e.qualificationLevelText || ''} in ${e.fieldOfStudy} - ${e.institution}${e.yearCompleted ? ` (${e.yearCompleted})` : ''}${e.cgpa ? `, CGPA ${e.cgpa}` : ''}`))}
      {section('Work experience', (c.workExperience || []).map((w) => `${w.jobTitle}, ${w.employer} (${yearOf(w.startDate)} - ${w.endDate ? yearOf(w.endDate) : 'present'})`))}
      {section('Exam grades', (c.examGrades || []).map((g) => `${g.level === 'OLevel' ? 'O-Level' : 'A-Level'} ${g.subject}: ${g.grade}`))}
      {section('Certificates and licences', (c.certificates || []).map((x) => `${x.name} - ${x.issuingOrganization}`))}
      {section('Eligibility answers', (applicant.eligibilityAnswers || []).map((q) => `${q.text}: ${typeof q.answer === 'boolean' ? (q.answer ? 'Yes' : 'No') : q.answer}`))}
      {applicant.whyThisRole && (
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Why this role</strong>
          <p style={{ fontSize: 13, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{applicant.whyThisRole}</p>
        </div>
      )}
      <strong style={{ fontSize: 14 }}>Documents</strong>
      <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
        {applicant.documents.map((d) => (
          <a key={d.id} href={`${API_URL}${d.fileUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Paperclip size={13} /> {{ Academic: 'Academic', Evidence: 'Evidence', Other: 'Other' }[d.category] || 'Other'}: {d.label || d.originalName}
          </a>
        ))}
        {applicant.coverLetterUrl && (
          <a href={`${API_URL}${applicant.coverLetterUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Paperclip size={13} /> Cover letter
          </a>
        )}
        {applicant.documents.length === 0 && !applicant.coverLetterUrl && <span style={muted}>No documents attached.</span>}
      </div>
    </Card>
  );
}

function RatingSheet({ token, applicant, onSaved, onNext }) {
  const confirm = useConfirm();
  const [values, setValues] = useState(applicant.ratings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [standingDown, setStandingDown] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { setValues(applicant.ratings); setError(''); setStandingDown(false); }, [applicant]);

  const set = (id, patch) => setValues({ ...values, [id]: { ...values[id], ...patch } });

  const save = async (andNext) => {
    setError(''); setSaving(true);
    try {
      const ratings = applicant.criteria.filter((c) => values[c.id]?.value != null)
        .map((c) => ({ criterionId: c.id, value: values[c.id].value, comment: values[c.id].comment || '' }));
      await client.put(`/api/shortlist-panel/${token}/applicants/${applicant.applicationId}/ratings`, { ratings });
      await onSaved();
      if (andNext) onNext();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your ratings');
    } finally {
      setSaving(false);
    }
  };

  const standDown = async () => {
    if (!(await confirm('Stand down for this applicant? Any ratings you gave them are cleared.', { title: 'Conflict of interest', confirmLabel: 'Stand down', danger: true }))) return;
    setError(''); setSaving(true);
    try {
      await client.post(`/api/shortlist-panel/${token}/applicants/${applicant.applicationId}/conflict`, { reason });
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record that');
    } finally {
      setSaving(false);
    }
  };

  if (applicant.conflict) {
    return <Card><Alert type="info" message={`You stood down for this applicant: ${applicant.conflict.reason}`} /></Card>;
  }

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Your ratings</h3>
      <Alert type="error" message={error} />
      {applicant.criteria.map((c) => {
        const v = values[c.id] || {};
        return (
          <fieldset key={c.id} disabled={!applicant.editable} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', margin: '0 0 10px' }}>
            <legend style={{ fontSize: 14, fontWeight: 600, padding: '0 4px' }}>{c.label} <span style={{ ...muted, fontWeight: 400 }}>· {c.kind}</span></legend>
            {c.reference && (
              <div style={{ ...muted, marginBottom: 6 }}>
                {c.reference.source}: {c.reference.detail}{c.reference.met === false ? ' (flagged)' : ''}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {c.kind === 'Essential'
                ? ESSENTIAL_OPTIONS.map((o) => (
                  <button key={o.value} type="button" aria-pressed={v.value === o.value} style={choice(v.value === o.value)} onClick={() => set(c.id, { value: o.value })}>{o.label}</button>
                ))
                : [1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" aria-pressed={v.value === n} title={DESIRABLE_LABELS[n]} style={choice(v.value === n)} onClick={() => set(c.id, { value: n })}>{n}</button>
                ))}
            </div>
            <input aria-label={`Comment on ${c.label}`} placeholder={c.kind === 'Essential' && v.value === 0 ? 'Why is it not met? (required)' : 'Comment (optional)'}
              value={v.comment || ''} onChange={(e) => set(c.id, { comment: e.target.value })}
              style={{ marginTop: 8, width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
          </fieldset>
        );
      })}
      {applicant.editable && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => save(false)} loading={saving}>Save</Button>
            <Button onClick={() => save(true)} loading={saving}>Save and next <ChevronRight size={14} /></Button>
            <Button variant="ghost" onClick={() => setStandingDown(!standingDown)}>I have a conflict of interest</Button>
          </div>
          {standingDown && (
            <div style={{ marginTop: 12 }}>
              <TextArea label="Why you should not rate this applicant" required value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="danger" onClick={standDown} disabled={reason.trim().length < 3} loading={saving}>Stand down</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Disputes({ token, disputes, onChanged }) {
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  const key = (d, i) => `${d.applicationId}|${i.criterionId}`;

  const rule = async (d, item) => {
    const draft = drafts[key(d, item)] || {};
    setError(''); setSaving(key(d, item));
    try {
      await client.put(`/api/shortlist-panel/${token}/decisions`, {
        applicationId: d.applicationId, criterionId: item.criterionId, outcome: draft.outcome, reason: draft.reason
      });
      await onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the ruling');
    } finally {
      setSaving(null);
    }
  };

  if (disputes.length === 0) return <Alert type="success" message="Nothing is in dispute - HR can close the exercise." />;
  return (
    <>
      <p style={muted}>
        The committee couldn't agree on these essential criteria. Record the committee's ruling on each, with the reason - the
        ranking updates as you go. HR closes the exercise once none are left.
      </p>
      <Alert type="error" message={error} />
      {disputes.map((d) => (
        <Card key={d.applicationId}>
          <h3 style={{ marginTop: 0 }}>{d.candidateName}</h3>
          {!d.canRule && (
            <Alert type="info" message={d.actingChair
              ? `You stood down from this applicant, so ${d.actingChair} is ruling on it in your place.`
              : 'You stood down from this applicant - HR will name an acting chair to rule on it.'} />
          )}
          {d.canRule && d.chairConflicted && <Alert type="info" message="The chair stood down from this applicant - HR has asked you to rule in their place." />}
          {d.items.map((item) => {
            const draft = drafts[key(d, item)] || {};
            const criterion = { kind: 'Essential' };
            return (
              <div key={item.criterionId} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, marginTop: 10 }}>
                <strong>{item.label}</strong>
                <ul style={{ fontSize: 13, paddingLeft: 18 }}>
                  {item.ratings.map((r) => <li key={r.name}>{r.name}: {ratingLabel(criterion, r.value)}{r.comment ? ` - "${r.comment}"` : ''}</li>)}
                </ul>
                {item.decision ? (
                  <p style={{ fontSize: 13 }}>
                    <StatusBadge status={item.decision.outcome === 'Met' ? 'Majority' : 'NotQualified'} label={item.decision.outcome === 'Met' ? 'Ruled met' : 'Ruled not met'} />
                    {' '}{item.decision.reason} <span style={muted}>- {item.decision.by}</span>
                  </p>
                ) : d.canRule && (
                  <>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                      {[['Met', 'Met'], ['NotMet', 'Not met']].map(([value, label]) => (
                        <button key={value} type="button" aria-pressed={draft.outcome === value} style={choice(draft.outcome === value)}
                          onClick={() => setDrafts({ ...drafts, [key(d, item)]: { ...draft, outcome: value } })}>{label}</button>
                      ))}
                    </div>
                    <TextArea label="The committee's reason" required value={draft.reason || ''}
                      onChange={(e) => setDrafts({ ...drafts, [key(d, item)]: { ...draft, reason: e.target.value } })} />
                    <Button onClick={() => rule(d, item)} disabled={!draft.outcome || (draft.reason || '').trim().length < 3} loading={saving === key(d, item)}>
                      <Gavel size={14} /> Record ruling
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </Card>
      ))}
    </>
  );
}

export default function ShortlistPanelAccess() {
  const { token } = useParams();
  const confirm = useConfirm();
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [openId, setOpenId] = useState(null);
  const [applicant, setApplicant] = useState(null);
  const [tab, setTab] = useState('applicants');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => client.get(`/api/shortlist-panel/${token}`)
    .then((res) => { setCtx(res.data); setError(''); })
    .catch((err) => { setCtx(null); setError(err.response?.data?.error || 'This link is not valid.'); }), [token]);
  useEffect(() => { load(); }, [load]);

  const openApplicant = useCallback((id) => {
    setOpenId(id); setApplicant(null);
    if (!id) return;
    client.get(`/api/shortlist-panel/${token}/applicants/${id}`)
      .then((res) => setApplicant(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Could not load this applicant'));
  }, [token]);

  const wrap = (children) => <div style={{ maxWidth: 1000, margin: '0 auto' }}>{children}</div>;
  if (error && !ctx) return wrap(<><PageHeader title="Shortlisting" /><Alert type="error" message={error} /></>);
  if (!ctx) return wrap(<><Skeleton width={260} height={22} style={{ marginBottom: 12 }} /><Skeleton width="100%" height={200} radius={6} /></>);

  const list = ctx.applicants;
  const index = list.findIndex((a) => a.applicationId === openId);
  const done = list.filter((a) => a.complete).length;
  const readOnly = ctx.stage !== 'Rating' || Boolean(ctx.submittedAt);

  const submit = async () => {
    if (!(await confirm('Submit your ratings? You won\'t be able to change them afterwards.', { title: 'Submit ratings', confirmLabel: 'Submit' }))) return;
    setSubmitting(true); setError('');
    try {
      const res = await client.post(`/api/shortlist-panel/${token}/submit`);
      setMessage(res.data.message);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not submit');
    } finally {
      setSubmitting(false);
    }
  };

  return wrap(
    <>
      <PageHeader
        title={`Shortlisting - ${ctx.vacancy.jobRef} ${ctx.vacancy.title}`}
        subtitle={`Hi ${ctx.name}${ctx.isChair ? ', you chair this committee' : ''}. Rate each applicant against the job's requirements - the other members can't see your ratings.`}
      />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      {ctx.stage === 'Rating' && !ctx.submittedAt && ctx.ratingDeadline && (
        <Alert type="info" message={`Ratings are due by ${new Date(ctx.ratingDeadline).toLocaleString()}.`} />
      )}
      {ctx.submittedAt && <Alert type="success" message="You have submitted your ratings. Thank you." />}
      {ctx.stage === 'Moderation' && !ctx.isChair && (
        <Alert type="info" message={ctx.disputes
          ? 'Rating has closed. HR has asked you to rule, in the chair\'s place, on an applicant the chair stood down from - see "Disputed items".'
          : 'Rating has closed. The chair is settling the items the committee disagreed on.'} />
      )}

      {ctx.disputes && ctx.stage === 'Moderation' && (
        <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 12 }}>
          {[['applicants', 'My ratings'], ['disputes', `Disputed items (${(ctx.disputes || []).filter((d) => d.items.some((i) => !i.decision)).length})`]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{
              background: 'none', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              borderBottom: `2px solid ${tab === k ? 'var(--color-primary)' : 'transparent'}`, color: tab === k ? 'var(--color-primary-dark)' : 'var(--color-text-muted)'
            }}>{k === 'disputes' && <Crown size={13} />} {label}</button>
          ))}
        </div>
      )}

      {tab === 'disputes' && ctx.disputes && ctx.stage === 'Moderation' ? (
        <Disputes token={token} disputes={ctx.disputes || []} onChanged={load} />
      ) : openId ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <Button variant="ghost" onClick={() => openApplicant(null)}><ChevronLeft size={14} /> All applicants</Button>
            <span style={muted}>Applicant {index + 1} of {list.length}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button variant="ghost" disabled={index <= 0} onClick={() => openApplicant(list[index - 1].applicationId)}><ChevronLeft size={14} /></Button>
              <Button variant="ghost" disabled={index >= list.length - 1} onClick={() => openApplicant(list[index + 1].applicationId)}><ChevronRight size={14} /></Button>
            </div>
          </div>
          {!applicant ? <Skeleton width="100%" height={240} radius={6} /> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ alignItems: 'start' }}>
              <Profile token={token} applicant={applicant} />
              <RatingSheet token={token} applicant={applicant} onSaved={load}
                onNext={() => (index < list.length - 1 ? openApplicant(list[index + 1].applicationId) : openApplicant(null))} />
            </div>
          )}
        </>
      ) : (
        <>
          <p style={muted}>
            {done} of {list.length} rated.{' '}
            {list.some((a) => a.calibration) && 'Applicants marked "calibration" are rated by every member, so the committee can compare standards.'}
          </p>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {list.map((a, i) => (
              <button key={a.applicationId} type="button" onClick={() => openApplicant(a.applicationId)} className="list-row" style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', textAlign: 'left', gap: 8,
                background: 'var(--color-bg)', border: 'none', borderTop: i ? '1px solid var(--color-border)' : 'none',
                padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, color: 'var(--color-text)'
              }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {a.complete ? <CheckCircle2 size={16} color="var(--color-accent)" /> : <Circle size={16} color="var(--color-border)" />}
                  {a.candidateName}
                  {a.calibration && <span style={muted}>· calibration</span>}
                </span>
                <span style={muted}>{a.conflict ? 'Stood down' : `${a.rated}/${ctx.criteria.length} rated`}</span>
              </button>
            ))}
          </Card>
          {!readOnly && (
            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button onClick={submit} disabled={done < list.length} loading={submitting}>Submit my ratings</Button>
              <span style={muted}>{done < list.length ? `Rate every applicant to submit (${list.length - done} left).` : 'Everything is rated. Submitting locks your ratings.'}</span>
            </div>
          )}
        </>
      )}
    </>
  );
}
