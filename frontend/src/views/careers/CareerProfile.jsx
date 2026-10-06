import React, { useRef, useState } from 'react';
import Button from '../../components/Button';
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
// public site the photo, links and "Fill in from your CV" are here.
const TITLES = {
  employment: 'UCAA employment', personal: 'Personal details', photo: 'Profile photo',
  entries: 'Education, experience and certificates', cv: 'Fill in from your CV'
};

export default function CareerProfile() {
  const { me, reload, error } = useCareer();
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const save = useRef(null);

  if (!me) return <CareerShell active="profile"><Skeleton width={240} height={26} /><Skeleton height={300} /></CareerShell>;

  const gaps = profileGaps(me);
  const complete = !gaps.employment && gaps.personal.length === 0;
  const check = employmentCheck(me);
  const p = me.internalProfile || {};
  const open = (key) => { setMessage(''); setEditing(key); };

  const saveAndClose = async () => {
    setSaving(true);
    const ok = await save.current?.();
    setSaving(false);
    if (ok) { setEditing(null); setMessage('Saved.'); reload(); }
  };

  const section = (title, key, badge, body, label = 'Edit') => (
    <Panel title={title} actions={<>{badge}<Button variant="secondary" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => open(key)}>{label}</Button></>}>{body}</Panel>
  );
  const list = (rows, empty) => (rows.length
    ? <table className="ws-table"><tbody>{rows.map(([k, t, s]) => <tr key={k}><td><span className="t">{t}</span>{s && <div className="s">{s}</div>}</td></tr>)}</tbody></table>
    : <span className="ws-note">{empty}</span>);

  return (
    <CareerShell active="profile">
      <PageTop title="My profile"
        subtitle={<Meta parts={[`${me.fullName} · ${me.email}`, complete ? <Pill tone="ok">Complete</Pill> : <Pill tone="warn">Needs {[...(gaps.employment ? ['employment details'] : []), ...gaps.personal].join(', ').toLowerCase()}</Pill>]} />}
        actions={!SITE.internal && <Button variant="secondary" onClick={() => open('cv')}>Fill in from your CV</Button>} />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      <div className="ws-grid-2">
        {SITE.internal && section('UCAA employment', 'employment', check.tone ? <Pill tone={check.tone}>{check.tone === 'ok' ? `Verified by HR · ${formatDay(p.verifiedDate)}` : check.label}</Pill> : null, (
          <>
            <KeyValues rows={[
              ['Employee ID', p.employeeId || null], ['Position', p.position || null], ['Department', p.department || null],
              ['Joined UCAA', p.dateJoined ? formatDay(p.dateJoined) : null], ['Supervisor', p.supervisorName ? `${p.supervisorName}${p.supervisorEmail ? ` · ${p.supervisorEmail}` : ''}` : null]
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
              ['National ID', me.nationalId ? <span className="ws-mono">{me.nationalId}</span> : null],
              !SITE.internal && ['Phone', me.phone || null],
              ['District of origin', me.districtOfOrigin || null], ['Lives in', me.location || null],
              ['Date of birth', me.dateOfBirth ? formatDay(me.dateOfBirth) : null],
              me.flyingHours != null && ['Flying hours', me.flyingHours],
              !SITE.internal && me.linkedinUrl && ['LinkedIn', me.linkedinUrl],
              !SITE.internal && me.portfolioUrl && ['Portfolio', me.portfolioUrl]
            ].filter(Boolean)} />
          </>
        ))}
        {section('Education', 'entries', null, list((me.education || []).map((e) => [e.id,
          `${e.qualificationLevelText || e.qualificationLevel}${e.fieldOfStudy ? ` in ${e.fieldOfStudy}` : ''}`,
          `${e.institution}${e.yearCompleted ? ` · ${e.yearCompleted}` : ''}${e.cgpa ? ` · CGPA ${e.cgpa}` : ''}`]), 'No qualifications yet.'), '+ Add')}
        {section('Work experience', 'entries', null, (me.workExperience || []).length
          ? list(me.workExperience.map((w) => [w.id, w.jobTitle, `${w.employer} · ${formatDay(w.startDate)} – ${w.endDate ? formatDay(w.endDate) : 'now'}`]), '')
          : <Alert type="warning" message="No jobs added yet. Most vacancies ask for years of experience, so add your work history." />, '+ Add')}
        {section('Certificates', 'entries', null, list((me.certificates || []).map((c) => [c.id, c.name,
          `${c.issuingOrganization}${c.issueDate ? ` · ${formatDay(c.issueDate)}` : ''}${c.expiryDate ? ` · expires ${formatDay(c.expiryDate)}` : ''}`]), 'None on file. Add any a vacancy asks for.'), '+ Add')}
        {section('O-Level and A-Level results', 'entries', null, list((me.examGrades || []).map((g) => [g.id,
          `${g.level === 'ALevel' ? 'A-Level' : g.level === 'OLevel' ? 'O-Level' : g.level} ${g.subject}`, `Grade ${g.grade}`]), 'None on file. Only needed when a vacancy asks for them.'), '+ Add')}
        <Panel title="Your data"><YourDataCard bare /></Panel>
      </div>

      {editing && (
        <SidePanel wide={['entries', 'cv'].includes(editing)} onClose={() => setEditing(null)} title={TITLES[editing]}
          footer={['entries', 'cv', 'photo'].includes(editing)
            ? <Button onClick={() => { setEditing(null); reload(); }}>Done</Button>
            : <><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} loadingText="Saving..." onClick={saveAndClose}>Save</Button></>}>
          {editing === 'employment' && (
            <>
              {check.tone === 'ok' && <Alert type="info" message="HR has verified these details. If you change them, HR checks them again before you can be shortlisted." />}
              <EmploymentForm me={me} bind={(fn) => { save.current = fn; }} />
            </>
          )}
          {editing === 'personal' && <PersonalForm me={me} links={!SITE.internal} bind={(fn) => { save.current = fn; }} />}
          {editing === 'photo' && <PhotoUploadPanel photoUrl={me.photoUrl} onChange={() => reload()} />}
          {editing === 'entries' && <ProfileStep profile={me} onProfileChange={reload} showPersonalDetails={false} profileDetails={{}} setProfileDetail={() => () => {}} />}
          {editing === 'cv' && <CvImport onAdded={reload} />}
        </SidePanel>
      )}
    </CareerShell>
  );
}
