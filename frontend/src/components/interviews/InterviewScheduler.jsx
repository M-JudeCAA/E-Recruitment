import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, AlertTriangle, CheckCircle2, CalendarPlus } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Modal from '../Modal';
import Button from '../Button';
import Alert from '../Alert';
import Select from '../Select';
import TextField from '../TextField';
import TextArea from '../TextArea';
import Spinner from '../Spinner';
import PanelEditor, { cleanPanel, emptyPanelist } from './PanelEditor';
import RubricEditor from './RubricEditor';
import {
  MODES, DEFAULT_DURATION, toLocalInput, fromLocalInput, formatDateTime, formatTime, formatDay,
  isWeekend, outsideWorkingHours, sameDay, CONFLICT_LABELS, errorMessage
} from '../../utils/interviews';
import { inputStyle, sectionLabel, hintText, chipStyle } from './formStyles';

const STEPS = ['Candidates', 'When & where', 'Panel & rubric', 'Review'];
const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 120, 180];

// A sensible default start: the next weekday at 09:00.
function nextWorkingMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

function Stepper({ step }) {
  return (
    <ol style={{ display: 'flex', gap: 6, listStyle: 'none', padding: 0, margin: '0 0 16px', flexWrap: 'wrap' }}>
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? 'step' : undefined} style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 10px', borderRadius: 999,
          background: i === step ? 'var(--color-primary)' : i < step ? 'var(--color-primary-light)' : 'var(--color-bg-subtle)',
          color: i === step ? '#fff' : i < step ? 'var(--color-primary-dark)' : 'var(--color-text-muted)', fontWeight: 600
        }}>
          <span>{i + 1}</span><span>{label}</span>
        </li>
      ))}
    </ol>
  );
}

// Books interviews - one candidate or a whole session - for one vacancy.
// Candidates are laid out back to back (duration + changeover gap, optional
// daily cap that rolls over to the next weekday), share one panel and one
// scoring rubric, and every slot is checked for clashes (candidate, panelist,
// room) before anything is booked. presetVacancyId/presetApplicationIds open
// it straight on a vacancy with those candidates ticked (the review card's
// "Schedule interview").
export default function InterviewScheduler({ onClose, onScheduled, presetVacancyId, presetApplicationIds }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');

  const [vacancies, setVacancies] = useState(null);
  const [vacancyId, setVacancyId] = useState(presetVacancyId ? String(presetVacancyId) : '');
  const [context, setContext] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [selected, setSelected] = useState([]); // ordered application ids

  const [startsAt, setStartsAt] = useState(toLocalInput(nextWorkingMorning()));
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION);
  const [gapMinutes, setGapMinutes] = useState(15);
  const [maxPerDay, setMaxPerDay] = useState('');
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [mode, setMode] = useState('In-person');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [instructions, setInstructions] = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const [panel, setPanel] = useState([emptyPanelist()]);
  const [criteria, setCriteria] = useState([]);

  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [allowConflicts, setAllowConflicts] = useState(false);
  const [notifyPanel, setNotifyPanel] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (presetVacancyId) return;
    staffClient.get('/api/vacancies/admin')
      .then((res) => setVacancies(res.data.filter((v) => !['PendingApproval', 'Draft'].includes(v.status))))
      .catch(() => setVacancies([]));
  }, [presetVacancyId]);

  useEffect(() => {
    if (!vacancyId) { setContext(null); return; }
    setLoadingContext(true);
    setError('');
    staffClient.get(`/api/interviews/vacancies/${vacancyId}/scheduling-context`)
      .then((res) => {
        const ctx = res.data;
        setContext(ctx);
        // Preselect: what the caller asked for, otherwise every Shortlisted
        // candidate with nothing booked yet.
        const preset = presetApplicationIds?.length ? presetApplicationIds : null;
        setSelected(preset
          ? ctx.applications.filter((a) => preset.includes(a.id)).map((a) => a.id)
          : ctx.applications.filter((a) => a.status === 'Shortlisted' && !a.interviewRounds.some((r) => r.status === 'Scheduled')).map((a) => a.id));
        if (ctx.lastLogistics) {
          if (ctx.lastLogistics.durationMinutes) setDurationMinutes(ctx.lastLogistics.durationMinutes);
          if (ctx.lastLogistics.mode) setMode(ctx.lastLogistics.mode);
          setLocation(ctx.lastLogistics.location || '');
          setMeetingLink(ctx.lastLogistics.meetingLink || '');
          setInstructions(ctx.lastLogistics.instructions || '');
        }
      })
      .catch((err) => setError(errorMessage(err, 'Could not load this vacancy\'s candidates')))
      .finally(() => setLoadingContext(false));
  }, [vacancyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const appsById = useMemo(() => new Map((context?.applications || []).map((a) => [a.id, a])), [context]);

  const toggle = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const move = (index, delta) => setSelected((prev) => {
    const next = [...prev];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    return next;
  });

  const payload = () => ({
    applicationIds: selected,
    startsAt: fromLocalInput(startsAt),
    durationMinutes: Number(durationMinutes),
    gapMinutes: Number(gapMinutes) || 0,
    maxPerDay: maxPerDay ? Number(maxPerDay) : null,
    skipWeekends,
    tzOffsetMinutes: new Date().getTimezoneOffset(),
    mode,
    location: mode === 'In-person' ? location : null,
    meetingLink: mode === 'Virtual' ? meetingLink : null,
    instructions,
    internalNotes,
    panelMembers: cleanPanel(panel),
    criteria: criteria.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 1, description: c.description || undefined }))
  });

  const stepError = () => {
    if (step === 0) {
      if (!vacancyId) return 'Choose a vacancy';
      if (selected.length === 0) return 'Tick at least one candidate';
    }
    if (step === 1) {
      if (!startsAt) return 'Choose when the first interview starts';
      if (new Date(startsAt) < new Date()) return 'The start time is in the past';
      if (mode === 'Virtual' && meetingLink && !/^https?:\/\/\S+$/i.test(meetingLink)) return 'The meeting link must start with http:// or https://';
    }
    if (step === 2) {
      if (cleanPanel(panel).length === 0) return 'Add at least one panelist';
      const badEmail = cleanPanel(panel).find((p) => p.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email));
      if (badEmail) return `"${badEmail.email}" is not a valid email`;
      const badWeight = criteria.find((c) => c.name.trim() && !(Number.isInteger(Number(c.weight)) && c.weight >= 1 && c.weight <= 10));
      if (badWeight) return `Weight for "${badWeight.name}" must be 1-10`;
    }
    return null;
  };

  const runPlan = async () => {
    setPlanning(true);
    setError('');
    try {
      const res = await staffClient.post(`/api/interviews/vacancies/${vacancyId}/plan`, payload());
      setPlan(res.data);
      setAllowConflicts(false);
    } catch (err) {
      setError(errorMessage(err, 'Could not work out the slots'));
    } finally {
      setPlanning(false);
    }
  };

  const next = async () => {
    const problem = stepError();
    if (problem) { setError(problem); return; }
    setError('');
    if (step === 2) await runPlan();
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await staffClient.post(`/api/interviews/vacancies/${vacancyId}/sessions`, { ...payload(), allowConflicts, notifyPanel });
      setDone(res.data);
      onScheduled?.(res.data);
    } catch (err) {
      if (err.response?.data?.code === 'SCHEDULE_CONFLICT' && err.response.data.slots) {
        // Something was booked in the meantime - show the fresh clashes.
        setPlan(err.response.data);
        setAllowConflicts(false);
      }
      setError(errorMessage(err, 'Could not schedule these interviews'));
    } finally {
      setSubmitting(false);
    }
  };

  const warnings = useMemo(() => {
    if (!plan) return [];
    const list = [];
    if (plan.slots.some((s) => isWeekend(s.start))) list.push('Some interviews fall on a weekend.');
    if (plan.slots.some((s) => outsideWorkingHours(s.start, s.end))) list.push('Some interviews run outside 08:00-17:00 - consider a daily cap.');
    return list;
  }, [plan]);

  if (done) {
    return (
      <Modal title="Interviews scheduled" onClose={onClose} maxWidth={520}
        footer={<Button onClick={onClose}>Done</Button>}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <CheckCircle2 size={22} color="var(--color-accent)" style={{ flexShrink: 0 }} />
          <div>
            <p style={{ marginTop: 0 }}>
              {done.rounds.length} interview{done.rounds.length === 1 ? '' : 's'} booked for {context?.vacancy.title}.
              Each candidate has been notified and asked to confirm.
            </p>
            <p style={hintText}>
              {done.panelEmailed > 0
                ? `${done.panelEmailed} panelist${done.panelEmailed === 1 ? '' : 's'} emailed a calendar invite covering their slots.`
                : 'No panelist was emailed (none had an email, or you chose not to).'}
              {' '}Send scoring links from the Interview Hub after each interview.
            </p>
          </div>
        </div>
      </Modal>
    );
  }

  const conflictCount = plan?.conflicts.length || 0;
  const footer = (
    <>
      <Button variant="ghost" onClick={step === 0 ? onClose : () => { setError(''); setStep((s) => s - 1); }} disabled={submitting}>
        {step === 0 ? 'Cancel' : 'Back'}
      </Button>
      {step < 3 && <Button onClick={next} loading={planning} loadingText="Checking slots...">Next</Button>}
      {step === 3 && (
        <Button onClick={submit} loading={submitting} loadingText="Scheduling..." disabled={!plan || (conflictCount > 0 && !allowConflicts)}>
          <CalendarPlus size={15} /> Schedule {selected.length} interview{selected.length === 1 ? '' : 's'}
        </Button>
      )}
    </>
  );

  return (
    <Modal title="Schedule interviews" onClose={onClose} maxWidth={880} footer={footer}>
      <Stepper step={step} />
      <Alert type="error" message={error} />

      {step === 0 && (
        <div>
          {!presetVacancyId && (
            <Select label="Vacancy" value={vacancyId} onChange={(e) => setVacancyId(e.target.value)} required>
              <option value="">{vacancies ? 'Choose a vacancy...' : 'Loading...'}</option>
              {(vacancies || []).map((v) => <option key={v.id} value={v.id}>{v.jobRef} — {v.title}</option>)}
            </Select>
          )}
          {loadingContext && <div style={{ padding: 16 }}><Spinner size={18} /></div>}
          {context && !loadingContext && (
            context.applications.length === 0 ? (
              <Alert type="info" message="No candidate on this vacancy can be interviewed yet - interviews open once a shortlist is approved." />
            ) : (
              <div>
                <span style={sectionLabel}>{context.vacancy.jobRef} — {context.vacancy.title}</span>
                <p style={{ ...hintText, margin: '0 0 8px' }}>
                  Tick who to interview. Slots follow the order on the right - use the arrows to change it.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                  <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', maxHeight: 340, overflowY: 'auto' }}>
                    {context.applications.map((a) => {
                      const booked = a.interviewRounds.filter((r) => r.status === 'Scheduled');
                      const last = a.interviewRounds[a.interviewRounds.length - 1];
                      return (
                        <label key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', alignItems: 'flex-start' }}>
                          <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggle(a.id)} style={{ marginTop: 3 }} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{a.candidate.fullName}</span>
                            {a.listStatus && <span style={{ ...hintText, marginLeft: 6 }}>{a.listStatus}{a.rank ? ` #${a.rank}` : ''}</span>}
                            <span style={{ display: 'block', ...hintText }}>
                              {a.status.replace(/([A-Z])/g, ' $1').trim()}
                              {booked.length > 0 && ` · already booked ${formatDateTime(booked[0].scheduledDate)}`}
                              {!booked.length && last && ` · round ${last.roundNumber} ${last.recommendation || last.status}`}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div>
                    <span style={sectionLabel}>Interview order ({selected.length})</span>
                    {selected.length === 0 && <p style={hintText}>Nobody ticked yet.</p>}
                    {selected.map((id, index) => (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 4, background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)' }}>
                        <span style={{ width: 22, ...hintText }}>{index + 1}.</span>
                        <span style={{ flex: 1, fontSize: 14 }}>{appsById.get(id)?.candidate.fullName}</span>
                        <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: index === 0 ? 0.3 : 1 }}><ArrowUp size={15} /></button>
                        <button type="button" aria-label="Move down" disabled={index === selected.length - 1} onClick={() => move(index, 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: index === selected.length - 1 ? 0.3 : 1 }}><ArrowDown size={15} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 16px' }}>
            <TextField label="First interview starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
            <Select label="Each interview lasts" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
              {DURATIONS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </Select>
            <Select label="Changeover between candidates" value={gapMinutes} onChange={(e) => setGapMinutes(Number(e.target.value))}>
              {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m === 0 ? 'None' : `${m} minutes`}</option>)}
            </Select>
            {selected.length > 1 && (
              <TextField label="At most per day (optional)" type="number" min="1" max="50" value={maxPerDay}
                onChange={(e) => setMaxPerDay(e.target.value)} hint="Carries on the next working day at the same time" />
            )}
          </div>
          {selected.length > 1 && maxPerDay && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginTop: -10, marginBottom: 16 }}>
              <input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} /> Skip Saturdays and Sundays
            </label>
          )}

          <span style={sectionLabel}>Format</span>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }} role="radiogroup" aria-label="Format">
            {MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} style={chipStyle(mode === m)}>{m}</button>
            ))}
          </div>
          {mode === 'In-person' && (
            <TextField label="Venue" placeholder="e.g. Board Room B, UCAA HQ Entebbe" value={location} onChange={(e) => setLocation(e.target.value)}
              hint="Used to warn you if the room is already booked" />
          )}
          {mode === 'Virtual' && (
            <TextField label="Meeting link" placeholder="https://..." value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)}
              hint="Sent to the candidate and the panel. Can be added later." />
          )}
          <TextArea label="Instructions for the candidate" value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="What to bring, where to report, who to ask for..." />
          <TextArea label="Internal notes (HR only)" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gap: 24 }}>
          <PanelEditor value={panel} onChange={setPanel} suggestions={context?.previousPanelists} />
          <RubricEditor value={criteria} onChange={setCriteria} previous={context?.lastCriteria} />
        </div>
      )}

      {step === 3 && plan && (
        <div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, marginBottom: 12 }}>
            <span><strong>{plan.slots.length}</strong> interview{plan.slots.length === 1 ? '' : 's'}</span>
            <span>{formatDateTime(plan.startsAt)} → {sameDay(plan.startsAt, plan.endsAt) ? formatTime(plan.endsAt) : formatDateTime(plan.endsAt)}</span>
            <span>{mode}{mode === 'In-person' && location ? ` · ${location}` : ''}</span>
            <span>{cleanPanel(panel).length} panelist{cleanPanel(panel).length === 1 ? '' : 's'}</span>
            <span>{criteria.filter((c) => c.name.trim()).length ? `${criteria.filter((c) => c.name.trim()).length}-criterion rubric` : 'Overall score'}</span>
          </div>
          {warnings.map((w) => <Alert key={w} type="warning" message={w} />)}

          <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            {plan.slots.map((s, i) => {
              const newDay = i === 0 || !sameDay(s.start, plan.slots[i - 1].start);
              return (
                <React.Fragment key={s.applicationId}>
                  {newDay && (
                    <div style={{ padding: '6px 12px', background: 'var(--color-bg-subtle)', fontSize: 12, fontWeight: 600, color: 'var(--color-primary-dark)' }}>
                      {formatDay(s.start)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, padding: '8px 12px', borderTop: '1px solid var(--color-border)', alignItems: 'flex-start', background: s.conflicts.length ? '#fbeceb' : undefined }}>
                    <span style={{ width: 160, flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}>{formatTime(s.start)} - {formatTime(s.end)}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{s.candidateName}</span>
                      {s.conflicts.map((c, ci) => (
                        <span key={ci} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--color-danger)', marginTop: 2 }}>
                          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {CONFLICT_LABELS[c.type]}: {c.message}
                        </span>
                      ))}
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
            {conflictCount > 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: 'var(--color-danger)' }}>
                <input type="checkbox" checked={allowConflicts} onChange={(e) => setAllowConflicts(e.target.checked)} />
                Schedule anyway - I have checked the {conflictCount} clash{conflictCount === 1 ? '' : 'es'} above
              </label>
            )}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
              <input type="checkbox" checked={notifyPanel} onChange={(e) => setNotifyPanel(e.target.checked)} />
              Email the panel a calendar invite (one email per panelist, covering all their slots)
            </label>
            <span style={hintText}>Every candidate is notified in-app and by email, and asked to confirm or request another time.</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={runPlan} style={{ ...inputStyle, cursor: 'pointer', fontSize: 13 }} disabled={planning}>
              {planning ? 'Re-checking...' : 'Re-check clashes'}
            </button>
          </div>
        </div>
      )}
      {step === 3 && !plan && !planning && <Alert type="error" message="Could not work out the slots - go back and try again." />}
    </Modal>
  );
}
