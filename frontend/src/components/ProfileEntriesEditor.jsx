import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import client from '../models/apiClient';
import TextField from './TextField';
import Select from './Select';
import Button from './Button';
import BulletListEditor from './BulletListEditor';
import { useConfirm } from './ConfirmDialog';
import { educationKey, workExperienceKey, certificateKey } from '../utils/entryDedup';

// A candidate's education, work experience and certificates, edited in place
// like the rest of the form: every entry is a set of fields, "Add another"
// only opens a blank one, and each entry saves itself shortly after it is
// changed, once its required fields are filled (POST the first time, PUT
// after) - nothing to click to save, nothing lost by forgetting to. Entries
// are candidate-level (/api/candidates/me/...), shared by every application.
// Used by My profile, Internal Careers' first sign-in and /profile/complete.
//
// The ref offers addFromCv(kind, values) - a suggestion read from a CV
// becomes an entry the same way (saved, marked "from your CV" so its dates
// get checked); false when the profile already has it - and flush(), which
// saves anything still waiting and resolves when every save is done.

const SAVE_DELAY_MS = 800;
const day = (v) => (v ? String(v).slice(0, 10) : '');

const LEVELS = [
  ['Certificate', 'Certificate'], ['Diploma', 'Diploma'], ['Bachelors', "Bachelor's"],
  ['Postgraduate', 'Postgraduate'], ['Masters', "Master's"], ['PhD', 'PhD']
];

export const ENTRY_KINDS = {
  education: {
    path: '/api/candidates/me/education',
    title: 'Education', noun: 'qualification', required: true,
    empty: { institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '', cgpa: '' },
    fromSaved: (e) => ({
      institution: e.institution || '', qualificationLevel: e.qualificationLevel || '', fieldOfStudy: e.fieldOfStudy || '',
      yearCompleted: e.yearCompleted ? String(e.yearCompleted) : '', cgpa: e.cgpa ? String(e.cgpa) : ''
    }),
    toPayload: (v) => ({ ...v, yearCompleted: v.yearCompleted ? Number(v.yearCompleted) : null, cgpa: v.cgpa || null }),
    missing: (v) => [!v.institution.trim() && 'institution', !v.qualificationLevel && 'qualification level', !v.fieldOfStudy.trim() && 'field of study'].filter(Boolean),
    key: educationKey
  },
  workExperience: {
    path: '/api/candidates/me/work-experience',
    title: 'Work experience', noun: 'job', required: true,
    empty: { employer: '', jobTitle: '', startDate: '', endDate: '', duties: [] },
    fromSaved: (w) => ({ employer: w.employer || '', jobTitle: w.jobTitle || '', startDate: day(w.startDate), endDate: day(w.endDate), duties: w.duties || [] }),
    toPayload: (v) => ({ ...v, endDate: v.endDate || null, duties: (v.duties || []).map((d) => d.trim()).filter(Boolean) }),
    missing: (v) => [!v.employer.trim() && 'employer', !v.jobTitle.trim() && 'job title', !v.startDate && 'start date'].filter(Boolean),
    key: workExperienceKey
  },
  certificates: {
    path: '/api/candidates/me/certificates',
    title: 'Professional certificates', noun: 'certificate', required: false,
    empty: { name: '', issuingOrganization: '', issueDate: '', expiryDate: '' },
    fromSaved: (c) => ({ name: c.name || '', issuingOrganization: c.issuingOrganization || '', issueDate: day(c.issueDate), expiryDate: day(c.expiryDate) }),
    toPayload: (v) => ({ ...v, issueDate: v.issueDate || null, expiryDate: v.expiryDate || null }),
    missing: (v) => [!v.name.trim() && 'certificate name', !v.issuingOrganization.trim() && 'issuing organisation'].filter(Boolean),
    key: certificateKey
  }
};
const KIND_NAMES = Object.keys(ENTRY_KINDS);

let rowSeq = 0;
const newRow = (values, extra = {}) => ({ key: `row-${++rowSeq}`, id: null, values, status: 'new', error: '', ...extra });
const isBlank = (values) => Object.values(values).every((v) => (Array.isArray(v) ? !v.some((d) => d.trim()) : !String(v).trim()));

function initialRows(profile) {
  const rows = {};
  for (const kind of KIND_NAMES) {
    const saved = (profile?.[kind] || []).map((e) => newRow(ENTRY_KINDS[kind].fromSaved(e), { id: e.id, status: 'saved' }));
    // A required list starts with a blank entry to fill in, like any other field.
    rows[kind] = saved.length || !ENTRY_KINDS[kind].required ? saved : [newRow({ ...ENTRY_KINDS[kind].empty })];
  }
  return rows;
}

const ProfileEntriesEditor = forwardRef(function ProfileEntriesEditor({ profile, onSaved, showMissing = false }, ref) {
  const confirm = useConfirm();
  const [rows, setRows] = useState(() => initialRows(profile));
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const timers = useRef({});
  const chains = useRef({});
  const removedIds = useRef(new Set());
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const patchRow = (kind, key, patch) => setRows((all) => {
    const next = { ...all, [kind]: all[kind].map((r) => (r.key === key ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)) };
    rowsRef.current = next;
    return next;
  });
  const dropRow = (kind, key) => setRows((all) => {
    const next = { ...all, [kind]: all[kind].filter((r) => r.key !== key) };
    rowsRef.current = next;
    return next;
  });
  const findRow = (kind, key) => rowsRef.current[kind].find((r) => r.key === key);

  // Saves run one after another per entry, so a POST finishes (and gives
  // the entry its id) before the next change is sent as a PUT.
  const enqueue = (key, fn) => {
    chains.current[key] = (chains.current[key] || Promise.resolve()).then(fn).catch(() => {});
    return chains.current[key];
  };

  const save = (kind, key) => enqueue(key, async () => {
    const row = findRow(kind, key);
    if (!row) return;
    const cfg = ENTRY_KINDS[kind];
    if (cfg.missing(row.values).length) { patchRow(kind, key, { status: 'incomplete', error: '' }); return; }
    const sent = row.values;
    patchRow(kind, key, { status: 'saving', error: '' });
    try {
      if (row.id) {
        await client.put(`${cfg.path}/${row.id}`, cfg.toPayload(sent));
      } else {
        const res = await client.post(cfg.path, cfg.toPayload(sent));
        // The API answers an entry the profile already has with that entry.
        if (rowsRef.current[kind].some((r) => r.key !== key && r.id === res.data.id)) {
          dropRow(kind, key);
          onSavedRef.current?.();
          return;
        }
        patchRow(kind, key, { id: res.data.id });
      }
      // Changed again while this was being sent? Then another save is on its way.
      patchRow(kind, key, (r) => ({ status: r.values === sent ? 'saved' : r.status }));
      onSavedRef.current?.();
    } catch (err) {
      patchRow(kind, key, { status: 'error', error: err.response?.data?.error || `Could not save this ${cfg.noun}` });
    }
  });

  const schedule = (kind, key, delay = SAVE_DELAY_MS) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => { delete timers.current[key]; save(kind, key); }, delay);
  };

  const change = (kind, key, field, value) => {
    patchRow(kind, key, (r) => ({ values: { ...r.values, [field]: value }, status: 'editing' }));
    schedule(kind, key);
  };

  const flush = () => {
    for (const kind of KIND_NAMES) {
      for (const row of rowsRef.current[kind]) {
        if (timers.current[row.key]) {
          clearTimeout(timers.current[row.key]);
          delete timers.current[row.key];
          save(kind, row.key);
        }
      }
    }
    return Promise.all(Object.values(chains.current));
  };

  // Entries added elsewhere (Internal Careers adds the current UCAA job) show
  // up when the profile is reloaded, in place of a blank entry nobody started.
  // Not while an entry of that kind is being created - it may be that one.
  useEffect(() => {
    if (!profile) return;
    setRows((all) => {
      let next = all;
      for (const kind of KIND_NAMES) {
        const known = new Set(all[kind].map((r) => r.id).filter(Boolean));
        const arrived = (profile[kind] || []).filter((e) => !known.has(e.id) && !removedIds.current.has(`${kind}-${e.id}`));
        if (!arrived.length || all[kind].some((r) => !r.id && r.status === 'saving')) continue;
        next = { ...next, [kind]: [
          ...all[kind].filter((r) => r.id || !isBlank(r.values)),
          ...arrived.map((e) => newRow(ENTRY_KINDS[kind].fromSaved(e), { id: e.id, status: 'saved' }))
        ] };
      }
      rowsRef.current = next;
      return next;
    });
  }, [profile]);

  // Leaving the page (or closing the panel) saves what is still waiting.
  useEffect(() => () => { flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (kind, values = ENTRY_KINDS[kind].empty, extra = {}) => {
    const row = newRow({ ...values }, extra);
    setRows((all) => {
      // A blank entry nobody has started is replaced, not kept beside it.
      const kept = extra.fromCv ? all[kind].filter((r) => r.id || !isBlank(r.values)) : all[kind];
      const next = { ...all, [kind]: [...kept, row] };
      rowsRef.current = next;
      return next;
    });
    return row;
  };

  const remove = async (kind, row) => {
    const cfg = ENTRY_KINDS[kind];
    clearTimeout(timers.current[row.key]);
    delete timers.current[row.key];
    if (!row.id && !chains.current[row.key]) { dropRow(kind, row.key); return; }
    if (!(await confirm(`Remove this ${cfg.noun} from your profile?`, { title: `Remove ${cfg.noun}`, confirmLabel: 'Remove', danger: true }))) return;
    await enqueue(row.key, async () => {
      const current = findRow(kind, row.key);
      try {
        if (current?.id) {
          await client.delete(`${cfg.path}/${current.id}`);
          removedIds.current.add(`${kind}-${current.id}`);
        }
        dropRow(kind, row.key);
        onSavedRef.current?.();
      } catch (err) {
        patchRow(kind, row.key, { status: 'error', error: err.response?.data?.error || `Could not remove this ${cfg.noun}` });
      }
    });
  };

  useImperativeHandle(ref, () => ({
    addFromCv(kind, values) {
      const cfg = ENTRY_KINDS[kind];
      const filled = { ...cfg.empty, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v : v == null ? '' : String(v)])) };
      if (kind !== 'education') for (const f of ['startDate', 'endDate', 'issueDate', 'expiryDate']) if (f in filled) filled[f] = day(filled[f]);
      const k = cfg.key(filled);
      if (rowsRef.current[kind].some((r) => cfg.key(r.values) === k)) return false;
      const row = add(kind, filled, { fromCv: true });
      schedule(kind, row.key, 0);
      return true;
    },
    flush
  }));

  const fieldsFor = (kind, row) => {
    const set = (field) => (e) => change(kind, row.key, field, e.target.value);
    const v = row.values;
    if (kind === 'education') return (
      <>
        <TextField format="title" label="Institution" required value={v.institution} onChange={set('institution')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <Select label="Qualification level" required value={v.qualificationLevel} onChange={set('qualificationLevel')}>
            <option value="">Select a level</option>
            {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <TextField format="title" label="Field of study" required value={v.fieldOfStudy} onChange={set('fieldOfStudy')} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField label="Year completed" type="number" hint="Leave blank if still in progress" value={v.yearCompleted} onChange={set('yearCompleted')} />
          <TextField label="CGPA" type="number" min="0" max="5" step="0.01" hint="Optional, 0-5 scale" value={v.cgpa} onChange={set('cgpa')} />
        </div>
      </>
    );
    if (kind === 'workExperience') return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField format="title" label="Employer" required value={v.employer} onChange={set('employer')} />
          <TextField format="title" label="Job title" required value={v.jobTitle} onChange={set('jobTitle')} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField label="Start date" type="date" required value={v.startDate} onChange={set('startDate')} />
          <TextField label="End date" type="date" hint="Leave blank if this is your current job" value={v.endDate} onChange={set('endDate')} />
        </div>
        <BulletListEditor label="Job duties" hint="What did this job involve? One duty per line."
          items={v.duties} onChange={(duties) => change(kind, row.key, 'duties', duties)} placeholder="e.g. Managed the on-call rotation" />
      </>
    );
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField format="title" label="Certificate name" required value={v.name} onChange={set('name')} />
          <TextField format="title" label="Issuing organisation" required value={v.issuingOrganization} onChange={set('issuingOrganization')} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField label="Issue date" type="date" value={v.issueDate} onChange={set('issueDate')} />
          <TextField label="Expiry date" type="date" hint="Leave blank if it does not expire" value={v.expiryDate} onChange={set('expiryDate')} />
        </div>
      </>
    );
  };

  const statusLine = (kind, row) => {
    const missing = ENTRY_KINDS[kind].missing(row.values);
    if (row.status === 'error') return <span style={{ color: 'var(--color-danger)' }}>{row.error}</span>;
    if (row.status === 'saving') return 'Saving...';
    if (row.status === 'saved') return row.fromCv ? 'Saved - from your CV, check the dates' : 'Saved';
    if (row.status === 'incomplete' || (showMissing && missing.length && row.status !== 'editing'))
      return <span style={{ color: 'var(--color-warning)' }}>Fill in the {missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing[0]} to save it</span>;
    if (row.status === 'editing') return 'Not saved yet';
    return null;
  };

  return (
    <div>
      {KIND_NAMES.map((kind) => {
        const cfg = ENTRY_KINDS[kind];
        const list = rows[kind];
        const savedCount = list.filter((r) => r.id).length;
        return (
          <section key={kind} style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, marginBottom: 8 }}>
              {cfg.title}{cfg.required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
            </h3>
            {cfg.required && savedCount === 0 && (
              <p style={{ fontSize: 13, color: showMissing ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: 0 }}>
                At least one {cfg.noun} is required.
              </p>
            )}
            {!cfg.required && list.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>None yet (optional).</p>
            )}
            {list.map((row, i) => (
              <div key={row.key} style={{
                marginBottom: 12, padding: 12, borderRadius: 'var(--radius-sm)',
                border: row.fromCv ? '1px dashed var(--color-primary)' : '1px solid var(--color-border)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <span>{cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} {i + 1}{row.fromCv ? ' · from your CV' : ''} {statusLine(kind, row) && <>· {statusLine(kind, row)}</>}</span>
                  <button type="button" className="ws-icon-btn" aria-label={`Remove ${cfg.noun} ${i + 1}`} onClick={() => remove(kind, row)}><Trash2 size={14} /></button>
                </div>
                {fieldsFor(kind, row)}
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={() => add(kind)}>
              <Plus size={14} /> {list.length ? `Add another ${cfg.noun}` : `Add a ${cfg.noun}`}
            </Button>
          </section>
        );
      })}
    </div>
  );
});

export default ProfileEntriesEditor;
