import React, { useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import { useConfirm } from '../../components/ConfirmDialog';
import { ENTRY_KINDS } from '../../components/ProfileEntriesEditor';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import Avatar from '../../components/Avatar';
import PhotoUploadPanel from '../../components/PhotoUploadPanel';
import YourDataCard from '../../components/YourDataCard';
import ProfileStep from '../apply-wizard/ProfileStep';
import { PageTop, Meta, Panel, Pill, KeyValues, SidePanel } from '../../components/workspace/ui';
import { candidateFileSrc } from '../../utils/fileSrc';
import { EmploymentForm, PersonalForm } from './forms';
import CvImport from './CvImport';
import { SITE, CareerShell, useCareer, profileGaps, employmentCheck, formatDay } from './careers';

// My profile (Internal Careers: /careers/profile; public site:
// /dashboard/profile): the profile as sections, each with its own Edit in a
// side panel, instead of one long form. On Internal Careers employment shows
// whether HR has verified it (changing it sends it back to HR); on the
// public site the photo and links are here. "Fill in from your CV" is on both.
// Education (with the O-Level and A-Level results), work experience and
// certificates each open their own form: "+ Add" starts a new entry of that
// kind, a row's Edit opens that entry (a job with its duties) and Delete
// removes it after a confirmation.
const TITLES = {
  employment: 'UCAA employment', personal: 'Personal details', photo: 'Profile photo', cv: 'Fill in from your CV',
  education: 'Education', workExperience: 'Work experience', certificates: 'Certificates'
};
const ENTRY_PANELS = ['education', 'workExperience', 'certificates'];
const levelName = (level) => (level === 'ALevel' ? 'A-Level' : level === 'OLevel' ? 'O-Level' : level);

export default function CareerProfile() {
  const { me, reload, error } = useCareer();
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [focusEntry, setFocusEntry] = useState(null);
  const [startNew, setStartNew] = useState(null);
  const [entryError, setEntryError] = useState('');
  const confirm = useConfirm();
  const save = useRef(null);
  const entries = useRef(null);

  if (!me) return <CareerShell active="profile"><Skeleton width={240} height={26} /><Skeleton height={300} /></CareerShell>;

  const gaps = profileGaps(me);
  const complete = !gaps.employment && gaps.personal.length === 0;
  const check = employmentCheck(me);
  const p = me.internalProfile || {};
  const open = (key) => { setMessage(''); setEntryError(''); setFocusEntry(null); setStartNew(null); setEditing(key); };
  const addEntry = (kind) => { open(kind); setStartNew(kind); };
  const editEntry = (kind, id) => { open(kind); setFocusEntry({ kind, id }); };
  // O-Level and A-Level results are not in ENTRY_KINDS (their own editor,
  // under Education), so they bring their own noun and path.
  const KINDS = { ...ENTRY_KINDS, examGrades: { noun: 'result', path: '/api/candidates/me/exam-grades' } };
  const deleteEntry = async (kind, id, title) => {
    const { noun, path } = KINDS[kind];
    if (!(await confirm(`Remove "${title}" from your profile?`, { title: `Remove ${noun}`, confirmLabel: 'Remove', danger: true }))) return;
    setMessage(''); setEntryError('');
    try {
      await client.delete(`${path}/${id}`);
      setMessage(`${noun[0].toUpperCase()}${noun.slice(1)} removed.`);
      reload();
    } catch (err) {
      setEntryError(err.response?.data?.error || `Could not remove this ${noun}`);
    }
  };

  const saveAndClose = async () => {
    setSaving(true);
    const ok = await save.current?.();
    setSaving(false);
    if (ok) { setEditing(null); setMessage('Saved.'); reload(); }
  };
  // The entry panels' Done: every entry has saved itself; this saves what is
  // still waiting and closes - unless an entry is missing something it needs,
  // which the editor shows.
  const finishEntries = async () => {
    setSaving(true);
    const ok = entries.current ? await entries.current.finish() : true;
    setSaving(false);
    if (ok) { setEditing(null); reload(); }
  };

  const section = (title, key, badge, body, label = 'Edit', onClick = () => open(key)) => (
    <Panel title={title} actions={<>{badge}<Button variant="secondary" style={{ padding: '4px 12px', fontSize: 13 }} onClick={onClick}>{label}</Button></>}>{body}</Panel>
  );
  // rows [key, title, details, more]; with `kind` each row has Edit and Delete.
  // A result's Edit opens the Education form, where its own editor sits.
  const list = (rows, empty, kind) => (rows.length
    ? <table className="ws-table"><tbody>{rows.map(([k, t, s, more]) => (
      <tr key={k}>
        <td><span className="t">{t}</span>{s && <div className="s">{s}</div>}{more}</td>
        {kind && (
          <td className="r" style={{ width: 76, whiteSpace: 'nowrap' }}>
            <button type="button" className="ws-icon-btn" style={{ display: 'inline-grid' }} title="Edit" aria-label={`Edit ${t}`}
              onClick={() => (kind === 'examGrades' ? open('education') : editEntry(kind, k))}><Pencil size={15} /></button>
            <button type="button" className="ws-icon-btn" style={{ display: 'inline-grid' }} title="Delete" aria-label={`Delete ${t}`} onClick={() => deleteEntry(kind, k, t)}><Trash2 size={15} /></button>
          </td>
        )}
      </tr>
    ))}</tbody></table>
    : <span className="ws-note">{empty}</span>);

  return (
    <CareerShell active="profile">
      <PageTop title="My profile"
        subtitle={<Meta parts={[`${me.fullName} · ${me.email}`, complete ? <Pill tone="ok">Complete</Pill> : <Pill tone="warn">Needs {[...(gaps.employment ? ['employment details'] : []), ...gaps.personal].join(', ').toLowerCase()}</Pill>]} />}
        actions={<Button variant="secondary" onClick={() => open('cv')}>Fill in from your CV</Button>} />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      <Alert type="error" message={entryError} />
      <div className="ws-grid-2">
        {SITE.internal && section('UCAA employment', 'employment', check.tone ? <Pill tone={check.tone}>{check.tone === 'ok' ? `Verified by HR · ${formatDay(p.verifiedDate)}` : check.label}</Pill> : null, (
          <>
            <KeyValues rows={[
              ['Employee number', p.employeeId || null], ['Job title', p.position || null], ['Department', p.department || null],
              ['Joined UCAA', p.dateJoined ? formatDay(p.dateJoined) : null]
            ]} />
            <div className="ws-note" style={{ marginTop: 8 }}>Changing these sends them back to HR to verify.</div>
          </>
        ))}
        {section('Personal details', 'personal', null, (
          <>
            {!SITE.internal && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Avatar src={candidateFileSrc(me.photoUrl)} size={48} />
                <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => open('photo')}>{me.photoUrl ? 'Change photo' : 'Add a photo'}</Button>
              </div>
            )}
            <KeyValues rows={[
              me.candidateType !== 'Internal' && ['National ID', me.nationalId ? <span className="ws-mono">{me.nationalId}</span> : null],
              !SITE.internal && ['Phone', me.phone || null],
              ['District of origin', me.districtOfOrigin || null], ['Place of residence', me.location || null],
              ['Date of birth', me.dateOfBirth ? formatDay(me.dateOfBirth) : null],
              me.flyingHours != null && ['Flying hours', me.flyingHours],
              !SITE.internal && me.linkedinUrl && ['LinkedIn', me.linkedinUrl],
              !SITE.internal && me.portfolioUrl && ['Portfolio', me.portfolioUrl]
            ].filter(Boolean)} />
          </>
        ))}
        {section('Education', 'education', null, (
          <>
            {list((me.education || []).map((e) => [e.id,
              `${e.qualificationLevelText || e.qualificationLevel}${e.fieldOfStudy ? ` in ${e.fieldOfStudy}` : ''}`,
              `${e.institution}${e.yearCompleted ? ` · ${e.yearCompleted}` : ''}${e.cgpa ? ` · CGPA ${e.cgpa}` : ''}`]), 'No qualifications yet.', 'education')}
            <h3 className="ws-subhead">O-Level and A-Level results</h3>
            {list((me.examGrades || []).map((g) => [g.id, `${levelName(g.level)} ${g.subject}`, `Grade ${g.grade}`]),
              'None on file. Only needed when a vacancy asks for them.', 'examGrades')}
          </>
        ), '+ Add', () => addEntry('education'))}
        {section('Work experience', 'workExperience', null, (me.workExperience || []).length
          ? list(me.workExperience.map((w) => {
            // How many duties are on file, so the candidate sees they were captured too.
            const duties = (w.duties || []).filter(Boolean).length;
            return [w.id, w.jobTitle, `${w.employer} · ${formatDay(w.startDate)} – ${w.endDate ? formatDay(w.endDate) : 'now'}`,
              <div className={`ws-duties${duties ? '' : ' none'}`}>{duties ? `${duties} ${duties === 1 ? 'duty' : 'duties'} listed` : 'No duties listed - add them with Edit'}</div>];
          }), '', 'workExperience')
          : <Alert type="warning" message="No jobs added yet. Most vacancies ask for years of experience, so add your work history." />, '+ Add', () => addEntry('workExperience'))}
        {section('Certificates', 'certificates', null, list((me.certificates || []).map((c) => [c.id, c.name,
          `${c.issuingOrganization}${c.issueDate ? ` · ${formatDay(c.issueDate)}` : ''}${c.expiryDate ? ` · expires ${formatDay(c.expiryDate)}` : ''}`]), 'None on file. Add any a vacancy asks for.', 'certificates'), '+ Add', () => addEntry('certificates'))}
        <Panel title="Your data"><YourDataCard bare /></Panel>
      </div>

      {editing && (
        <SidePanel wide={[...ENTRY_PANELS, 'cv'].includes(editing)} onClose={() => setEditing(null)} title={TITLES[editing]}
          footer={[...ENTRY_PANELS, 'cv', 'photo'].includes(editing)
            ? (editing === 'photo'
              ? <Button onClick={() => { setEditing(null); reload(); }}>Done</Button>
              : <Button loading={saving} loadingText="Saving..." onClick={finishEntries}>Done</Button>)
            : <><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} loadingText="Saving..." onClick={saveAndClose}>Save</Button></>}>
          {editing === 'employment' && (
            <>
              {check.tone === 'ok' && <Alert type="info" message="HR has verified these details. If you change them, HR checks them again before you can be shortlisted." />}
              <EmploymentForm me={me} bind={(fn) => { save.current = fn; }} />
            </>
          )}
          {editing === 'personal' && <PersonalForm me={me} links={!SITE.internal} bind={(fn) => { save.current = fn; }} />}
          {editing === 'photo' && <PhotoUploadPanel photoUrl={me.photoUrl} onChange={() => reload()} />}
          {ENTRY_PANELS.includes(editing) && (
            <ProfileStep key={`${editing}-${startNew || ''}`} profile={me} onProfileChange={reload} showPersonalDetails={false}
              profileDetails={{}} setProfileDetail={() => () => {}} entryKinds={[editing]} startNew={startNew} focusEntry={focusEntry} entriesRef={entries} />
          )}
          {editing === 'cv' && <CvImport profile={me} onAdded={reload} entriesRef={entries} links={!SITE.internal} />}
        </SidePanel>
      )}
    </CareerShell>
  );
}
