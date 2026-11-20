import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import client from '../models/apiClient';
import TextField from './TextField';
import Select from './Select';
import Button from './Button';
import TextArea from './TextArea';
import { splitDuties, dutiesToText } from '../utils/dutyList';
import { useConfirm } from './ConfirmDialog';
import { educationKey, workExperienceKey, certificateKey } from '../utils/entryDedup';
import { today, certificateDatesError, workDatesError, yearCompletedError } from '../utils/profileValidation';
import { workOverlaps } from '../utils/workOverlaps';

// Overlapping jobs among the editor's rows, and a pair's signature - the
// keys and dates, so a confirmed overlap is asked about again if the dates change.
const overlapsOf = (jobs) => workOverlaps(jobs.map((r) => ({ key: r.key, startDate: r.values.startDate, endDate: r.values.endDate })));
const overlapSignature = (jobs, { a, b }) => [a, b].map((k) => {
  const v = jobs.find((r) => r.key === k)?.values || {};
  return `${k}:${v.startDate}:${v.endDate}`;
}).join('|');

// A candidate's education, work experience and certificates. Each saved
// entry is one summary line with Edit and Delete; Edit opens its fields,
// which stay open until the panel or page closes - no Done per entry, since
// nothing needs one. An entry saves itself shortly after it is changed,
// once its required fields are filled (POST the first time, PUT after) -
// nothing to click to save, nothing lost by forgetting to. Only entries that
// need attention open by themselves: a new one, one with a required field
// missing, one that failed to save. Entries are candidate-level
// (/api/candidates/me/...), shared by every application. Used by My profile,
// the first sign-in setup on both sites and the apply wizard.
//
// The ref offers addFromCv(kind, values) - a suggestion read from a CV
// becomes an entry the same way (saved, marked "from your CV" so its dates
// get checked; closed unless something is missing) - true, or 'incomplete'
// when a required field is missing (it opens to be filled in); false when the
// profile already has it - flush(), which saves anything still waiting and
// resolves when every save is done, and finish(), for the Done of the panel
// or page around it (no entry has a Done of its own): it drops blank new
// entries, saves the rest, and answers false while an entry someone started
// still lacks a required field (shown, with what it needs). `focus` ({ kind, id }) opens that entry
// and scrolls to it (My profile's Edit on one entry). `kinds` shows only
// those sections (My profile's "+ Add" on Education opens the education
// form alone), `startNew` (a kind) opens a blank entry of it ready to fill
// in, and `educationExtra` is shown at the end of the Education section
// (the O-Level and A-Level results, which belong with education).

const SAVE_DELAY_MS = 800;
const day = (v) => (v ? String(v).slice(0, 10) : '');
const month = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '');

const LEVELS = [
  ['Certificate', 'Certificate'], ['Diploma', 'Diploma'], ['Bachelors', "Bachelor's"],
  ['Postgraduate', 'Postgraduate'], ['Masters', "Master's"], ['PhD', 'PhD']
];

export const ENTRY_KINDS = {
  education: {
    path: '/api/candidates/me/education',
    title: 'Education', noun: 'qualification', required: true,
    // A small subtitle under the section's heading.
    guide: 'Qualifications from a school, college, institute or university - certificate courses included.',
    empty: { institution: '', qualificationLevel: '', fieldOfStudy: '', yearCompleted: '', cgpa: '' },
    fromSaved: (e) => ({
      institution: e.institution || '', qualificationLevel: e.qualificationLevel || '', fieldOfStudy: e.fieldOfStudy || '',
      yearCompleted: e.yearCompleted ? String(e.yearCompleted) : '', cgpa: e.cgpa ? String(e.cgpa) : ''
    }),
    toPayload: (v) => ({ ...v, yearCompleted: v.yearCompleted ? Number(v.yearCompleted) : null, cgpa: v.cgpa || null }),
    missing: (v) => [!v.institution.trim() && 'institution', !v.qualificationLevel && 'qualification level', !v.fieldOfStudy.trim() && 'field of study'].filter(Boolean),
    // The entry's summary line: [title, details].
    summary: (v) => [
      `${(LEVELS.find(([value]) => value === v.qualificationLevel) || [])[1] || v.qualificationLevel || 'Qualification'}${v.fieldOfStudy ? ` in ${v.fieldOfStudy}` : ''}`,
      [v.institution, v.yearCompleted || 'in progress', v.cgpa && `CGPA ${v.cgpa}`].filter(Boolean).join(' · ')
    ],
    // A problem with what was entered (backend utils/profileValidation.js), or null.
    invalid: (v) => yearCompletedError(v.yearCompleted),
    key: educationKey
  },
  workExperience: {
    path: '/api/candidates/me/work-experience',
    title: 'Work experience', noun: 'job', required: true,
    // The order entered means nothing - jobs are listed newest first, by their dates (UAT-034).
    guide: 'Add your jobs in any order - they are listed newest first, by their dates.',
    // duties: the text box's text; saved as a list, one duty per line or bullet.
    empty: { employer: '', jobTitle: '', startDate: '', endDate: '', duties: '' },
    fromSaved: (w) => ({ employer: w.employer || '', jobTitle: w.jobTitle || '', startDate: day(w.startDate), endDate: day(w.endDate), duties: dutiesToText(w.duties) }),
    toPayload: (v) => ({ ...v, endDate: v.endDate || null, duties: splitDuties(v.duties) }),
    missing: (v) => [!v.employer.trim() && 'employer', !v.jobTitle.trim() && 'job title', !v.startDate && 'start date'].filter(Boolean),
    summary: (v) => {
      const duties = splitDuties(v.duties).length;
      return [v.jobTitle || 'Job', [v.employer, v.startDate && `${month(v.startDate)} – ${v.endDate ? month(v.endDate) : 'now'}`,
        duties && `${duties} ${duties === 1 ? 'duty' : 'duties'}`].filter(Boolean).join(' · ')];
    },
    invalid: (v) => (v.startDate ? workDatesError(v) : null),
    key: workExperienceKey
  },
  certificates: {
    path: '/api/candidates/me/certificates',
    title: 'Professional certificates and licences', noun: 'certificate', required: false,
    guide: 'Professional qualifications, licences and short courses - e.g. ACCA, CPA, an ATC licence, first aid. A certificate course from a college or university goes under Education.',
    empty: { name: '', issuingOrganization: '', issueDate: '', expiryDate: '' },
    fromSaved: (c) => ({ name: c.name || '', issuingOrganization: c.issuingOrganization || '', issueDate: day(c.issueDate), expiryDate: day(c.expiryDate) }),
    toPayload: (v) => ({ ...v, issueDate: v.issueDate || null, expiryDate: v.expiryDate || null }),
    missing: (v) => [!v.name.trim() && 'certificate name', !v.issuingOrganization.trim() && 'issuing organisation'].filter(Boolean),
    summary: (v) => [v.name || 'Certificate', [v.issuingOrganization, v.issueDate && month(v.issueDate), v.expiryDate && `expires ${month(v.expiryDate)}`].filter(Boolean).join(' · ')],
    invalid: certificateDatesError,
    key: certificateKey
  }
};
const KIND_NAMES = Object.keys(ENTRY_KINDS);

let rowSeq = 0;
// open: its fields are showing (else just its summary line, with Edit and Delete).
const newRow = (values, extra = {}) => ({ key: `row-${++rowSeq}`, id: null, values, status: 'new', error: '', open: true, ...extra });
const isBlank = (values) => Object.values(values).every((v) => (Array.isArray(v) ? !v.some((d) => d.trim()) : !String(v).trim()));

function initialRows(profile) {
  const rows = {};
  for (const kind of KIND_NAMES) {
    const saved = (profile?.[kind] || []).map((e) => newRow(ENTRY_KINDS[kind].fromSaved(e), { id: e.id, status: 'saved', open: false }));
    // A required list starts with a blank entry to fill in, like any other field.
    rows[kind] = saved.length || !ENTRY_KINDS[kind].required ? saved : [newRow({ ...ENTRY_KINDS[kind].empty })];
  }
  return rows;
}

const ProfileEntriesEditor = forwardRef(function ProfileEntriesEditor({
  profile, onSaved, showMissing = false, focus = null, kinds = KIND_NAMES, startNew = null, educationExtra = null
}, ref) {
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
    if (cfg.missing(row.values).length) { patchRow(kind, key, { status: 'incomplete', error: '', open: true }); return; }
    // Dates out of order or in the future: said on the entry, not sent.
    const invalid = cfg.invalid?.(row.values);
    if (invalid) { patchRow(kind, key, { status: 'error', error: invalid, open: true }); return; }
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
      patchRow(kind, key, { status: 'error', error: err.response?.data?.error || `Could not save this ${cfg.noun}`, open: true });
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
          ...arrived.map((e) => newRow(ENTRY_KINDS[kind].fromSaved(e), { id: e.id, status: 'saved', open: false }))
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
        patchRow(kind, row.key, { status: 'error', error: err.response?.data?.error || `Could not remove this ${cfg.noun}`, open: true });
      }
    });
  };

  // What stops the Done, in words naming the entry and the field (UAT-028):
  // "Education - Bachelor's in IT (qualification 2): fill in the institution."
  const [problem, setProblemState] = useState(null); // { kind, key, text }
  const problemRef = useRef(null); // read by problem() straight after finish()
  const confirmedOverlaps = useRef(new Set());
  const setProblem = (p) => { problemRef.current = p; setProblemState(p); };
  const nameOf = (kind, row) => {
    const cfg = ENTRY_KINDS[kind];
    const i = rowsRef.current[kind].findIndex((r) => r.key === row.key);
    const [title] = cfg.summary(row.values);
    const generic = ['Qualification', 'Job', 'Certificate'].includes(title);
    return `${cfg.title} - ${generic ? `${cfg.noun} ${i + 1}` : `“${title}” (${cfg.noun} ${i + 1})`}`;
  };
  const listOf = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0]);
  const showEntry = (key, block = 'center') => setTimeout(() => {
    const el = document.querySelector(`[data-entry="${key}"]`);
    el?.scrollIntoView({ block, behavior: 'smooth' });
    el?.querySelector('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
  }, 50);

  // The panel's Done (there is none per entry - each saves itself): new
  // entries nobody started are dropped, everything waiting is saved, and the
  // answer is false - with the first entry still missing a required field
  // (or refused) marked, named above the list and brought into view - while
  // one someone started can't be saved.
  const finish = async () => {
    setProblem(null);
    // Dropped here, and left out below whether or not React has re-rendered yet.
    const dropped = new Set();
    for (const kind of KIND_NAMES) {
      for (const row of rowsRef.current[kind]) {
        if (!row.id && isBlank(row.values) && !chains.current[row.key]) {
          clearTimeout(timers.current[row.key]);
          delete timers.current[row.key];
          dropRow(kind, row.key);
          dropped.add(row.key);
        }
      }
    }
    await flush();
    for (const kind of KIND_NAMES) {
      const row = rowsRef.current[kind].find((r) => !dropped.has(r.key) && ENTRY_KINDS[kind].missing(r.values).length);
      if (row) {
        patchRow(kind, row.key, { status: 'incomplete', open: true });
        setProblem({ kind, key: row.key, text: `${nameOf(kind, row)}: fill in the ${listOf(ENTRY_KINDS[kind].missing(row.values))}, or delete the entry.` });
        showEntry(row.key);
        return false;
      }
    }
    for (const kind of KIND_NAMES) {
      const row = rowsRef.current[kind].find((r) => !dropped.has(r.key) && r.status === 'error');
      if (row) {
        patchRow(kind, row.key, { open: true });
        setProblem({ kind, key: row.key, text: `${nameOf(kind, row)}: ${row.error}` });
        showEntry(row.key);
        return false;
      }
    }
    // Jobs with overlapping dates: asked once (per set of dates), never refused (UAT-007).
    const jobs = rowsRef.current.workExperience.filter((r) => !dropped.has(r.key));
    const pending = overlapsOf(jobs).filter((o) => !confirmedOverlaps.current.has(overlapSignature(jobs, o)));
    if (pending.length && kinds.includes('workExperience')) {
      const titleOf = (key) => `“${ENTRY_KINDS.workExperience.summary(jobs.find((r) => r.key === key).values)[0]}”`;
      const pairs = pending.map((o) => `${titleOf(o.a)} and ${titleOf(o.b)}${o.identical ? ' (the same dates)' : ''}`);
      const ok = await confirm(
        `The dates of ${listOf(pairs)} overlap. That is fine if you held these jobs at the same time - your experience counts the overlapping time once. Otherwise, correct the dates.`,
        { title: 'Jobs with overlapping dates', confirmLabel: 'Yes, I held them at the same time', cancelLabel: 'Let me correct the dates' }
      );
      if (!ok) {
        setProblem({ kind: 'workExperience', key: pending[0].a, text: `Correct the dates of ${pairs[0]}, which overlap.` });
        patchRow('workExperience', pending[0].a, { open: true });
        showEntry(pending[0].a);
        return false;
      }
      for (const o of pending) confirmedOverlaps.current.add(overlapSignature(jobs, o));
    }
    return true;
  };

  // My profile's "+ Add": a blank entry of that kind, open and in view (the
  // blank one already waiting, if there is one). Once, even when React runs
  // the effect twice.
  const started = useRef(false);
  useEffect(() => {
    if (!startNew || started.current) return;
    started.current = true;
    const blank = rowsRef.current[startNew].find((r) => !r.id && isBlank(r.values));
    const row = blank || add(startNew);
    if (blank) patchRow(startNew, blank.key, { open: true });
    setTimeout(() => document.querySelector(`[data-entry="${row.key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [startNew]); // eslint-disable-line react-hooks/exhaustive-deps

  // My profile's Edit on one entry opens it here.
  useEffect(() => {
    if (!focus) return;
    const row = rowsRef.current[focus.kind]?.find((r) => r.id === focus.id);
    if (!row) return;
    patchRow(focus.kind, row.key, { open: true });
    setTimeout(() => document.querySelector(`[data-entry="${row.key}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    // batch: which CV import added it, so undoCv(batch) can take it back.
    addFromCv(kind, values, batch = null) {
      const cfg = ENTRY_KINDS[kind];
      const filled = { ...cfg.empty, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? dutiesToText(v) : v == null ? '' : String(v)])) };
      if (kind !== 'education') for (const f of ['startDate', 'endDate', 'issueDate', 'expiryDate']) if (f in filled) filled[f] = day(filled[f]);
      const k = cfg.key(filled);
      if (rowsRef.current[kind].some((r) => cfg.key(r.values) === k)) return false;
      const row = add(kind, filled, { fromCv: true, open: false, cvBatch: batch });
      schedule(kind, row.key, 0);
      return cfg.missing(filled).length ? 'incomplete' : true;
    },
    // Removes every entry one CV import added (UAT-025) - once its save has
    // finished, so nothing is left behind. Resolves to how many were removed.
    async undoCv(batch) {
      let removed = 0;
      for (const kind of KIND_NAMES) {
        for (const row of rowsRef.current[kind].filter((r) => r.cvBatch === batch)) {
          clearTimeout(timers.current[row.key]);
          delete timers.current[row.key];
          await enqueue(row.key, async () => {
            const current = findRow(kind, row.key);
            try {
              if (current?.id) {
                await client.delete(`${ENTRY_KINDS[kind].path}/${current.id}`);
                removedIds.current.add(`${kind}-${current.id}`);
              }
              dropRow(kind, row.key);
              removed += 1;
            } catch (err) {
              patchRow(kind, row.key, { status: 'error', error: err.response?.data?.error || `Could not remove this ${ENTRY_KINDS[kind].noun}`, open: true });
            }
          });
        }
      }
      if (removed) onSavedRef.current?.();
      return removed;
    },
    flush,
    finish,
    // What stopped the last finish(), in words - for a message beside the Done.
    problem: () => problemRef.current?.text || null
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
          <TextField label="Year completed" type="number" min="1950" max={today().slice(0, 4)} hint="Leave blank if still in progress" value={v.yearCompleted} onChange={set('yearCompleted')} />
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
          <TextField label="Start date" type="date" required max={today()} value={v.startDate} onChange={set('startDate')} />
          <TextField label="End date" type="date" min={v.startDate || undefined} max={today()} hint="Leave blank if this is your current job" value={v.endDate} onChange={set('endDate')} />
        </div>
        {/* Paste a bulleted or numbered list straight in; on leaving the box
            it is tidied to one bullet per duty, as it is saved. */}
        <TextArea label="Job duties" rows={5}
          hint="Type or paste them - a bulleted or numbered list, or one duty per line."
          placeholder={'• Managed the on-call rotation\n• Trained new staff'}
          value={v.duties} onChange={set('duties')}
          onBlur={() => {
            const tidy = dutiesToText(splitDuties(v.duties));
            if (tidy !== v.duties) change(kind, row.key, 'duties', tidy);
          }} />
      </>
    );
    return (
      <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField format="title" label="Certificate name" required value={v.name} onChange={set('name')} />
          <TextField format="title" label="Issuing organisation" required value={v.issuingOrganization} onChange={set('issuingOrganization')} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
          <TextField label="Issue date" type="date" max={today()} value={v.issueDate} onChange={set('issueDate')} />
          <TextField label="Expiry date" type="date" min={v.issueDate || undefined} hint="Leave blank if it does not expire" value={v.expiryDate} onChange={set('expiryDate')} />
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

  // The problem named by the last Done, while it still stands.
  const problemRow = problem && rows[problem.kind]?.find((r) => r.key === problem.key);
  const problemStands = problemRow && (ENTRY_KINDS[problem.kind].missing(problemRow.values).length > 0 || problemRow.status === 'error');
  // Each job's overlaps with others, said on the entry (UAT-007).
  const overlaps = overlapsOf(rows.workExperience);
  const overlapNote = (row) => {
    const mine = overlaps.filter((o) => o.a === row.key || o.b === row.key);
    if (!mine.length) return null;
    const others = mine.map((o) => {
      const other = rows.workExperience.find((r) => r.key === (o.a === row.key ? o.b : o.a));
      return `“${ENTRY_KINDS.workExperience.summary(other.values)[0]}”${o.identical ? ' (same dates)' : ''}`;
    });
    return `Dates overlap with ${listOf(others)} - fine if you held both at the same time; otherwise correct the dates.`;
  };

  return (
    <div>
      {problemStands && (
        <div role="alert" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 12, border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-danger)' }}>
          <span>{problem.text}</span>
          <button type="button" onClick={() => { patchRow(problem.kind, problem.key, { open: true }); showEntry(problem.key); }}
            style={{ flex: 'none', fontSize: 13, color: 'var(--color-primary)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
            Show me
          </button>
        </div>
      )}
      {KIND_NAMES.filter((kind) => kinds.includes(kind)).map((kind) => {
        const cfg = ENTRY_KINDS[kind];
        const list = rows[kind];
        const savedCount = list.filter((r) => r.id).length;
        return (
          <section key={kind} style={{ marginBottom: 24 }}>
            {/* One section alone sits in a panel already titled with it. */}
            {kinds.length > 1 && (
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>
                {cfg.title}{cfg.required && <span style={{ color: 'var(--color-primary)', marginLeft: 4 }}>*</span>}
              </h3>
            )}
            {cfg.guide && <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>{cfg.guide}</p>}
            {cfg.required && savedCount === 0 && (
              <p style={{ fontSize: 13, color: showMissing ? 'var(--color-danger)' : 'var(--color-text-muted)', marginTop: 0 }}>
                At least one {cfg.noun} is required.
              </p>
            )}
            {!cfg.required && list.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>None yet (optional).</p>
            )}
            {list.map((row, i) => {
              const [title, details] = cfg.summary(row.values);
              const status = statusLine(kind, row);
              const overlap = kind === 'workExperience' ? overlapNote(row) : null;
              const overlapLine = overlap && <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 4 }}>{overlap}</div>;
              const actions = (
                <span style={{ display: 'flex', gap: 2, flex: 'none' }}>
                  {!row.open && (
                    <button type="button" className="ws-icon-btn" aria-label={`Edit ${cfg.noun} ${i + 1}`} title="Edit"
                      onClick={() => patchRow(kind, row.key, { open: true })}><Pencil size={14} /></button>
                  )}
                  <button type="button" className="ws-icon-btn" aria-label={`Delete ${cfg.noun} ${i + 1}`} title="Delete"
                    onClick={() => remove(kind, row)}><Trash2 size={14} /></button>
                </span>
              );
              return (
                <div key={row.key} data-entry={row.key} style={{
                  marginBottom: 8, padding: row.open ? 12 : '10px 12px', borderRadius: 'var(--radius-sm)', scrollMarginTop: 16,
                  border: row.fromCv ? '1px dashed var(--color-primary)' : '1px solid var(--color-border)'
                }}>
                  {row.open ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {/* Named by what it is, not "Job 1", which read as the first job (UAT-034). */}
                        <span>{['Qualification', 'Job', 'Certificate'].includes(title) ? `New ${cfg.noun}` : title}{row.fromCv ? ' · from your CV' : ''} {status && <>· {status}</>}</span>
                        {actions}
                      </div>
                      {fieldsFor(kind, row)}
                      {overlapLine}
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
                        {details && <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{details}</div>}
                        {(row.fromCv || (status && row.status !== 'saved')) && (
                          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                            {row.fromCv && <span style={{ color: 'var(--color-primary)' }}>From your CV - check it, especially the dates</span>}
                            {row.status !== 'saved' && status && <>{row.fromCv && ' · '}{status}</>}
                          </div>
                        )}
                        {overlapLine}
                      </div>
                      {actions}
                    </div>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="ghost" onClick={() => add(kind)}>
              <Plus size={14} /> {list.length ? `Add another ${cfg.noun}` : `Add a ${cfg.noun}`}
            </Button>
            {kind === 'education' && educationExtra && <div style={{ marginTop: 20 }}>{educationExtra}</div>}
          </section>
        );
      })}
    </div>
  );
});

export default ProfileEntriesEditor;
