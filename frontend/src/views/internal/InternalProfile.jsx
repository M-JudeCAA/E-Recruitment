import React, { useRef, useState } from 'react';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import YourDataCard from '../../components/YourDataCard';
import ProfileStep from '../apply-wizard/ProfileStep';
import { PageTop, Meta, Panel, Pill, KeyValues, SidePanel } from '../../components/workspace/ui';
import { EmploymentForm, PersonalForm } from './forms';
import { InternalShell, useCareer, profileGaps, employmentCheck, formatDay } from './careers';

// My profile on Internal Careers (/careers/profile): the profile as
// sections, each with its own Edit, instead of one long form. Employment
// shows whether HR has verified it; changing it sends it back to HR.
export default function InternalProfile() {
  const { me, reload, error } = useCareer();
  const [editing, setEditing] = useState(null); // employment | personal | entries
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const save = useRef(null);

  if (!me) return <InternalShell active="profile"><Skeleton width={240} height={26} /><Skeleton height={300} /></InternalShell>;

  const gaps = profileGaps(me);
  const complete = !gaps.employment && gaps.personal.length === 0;
  const check = employmentCheck(me);
  const p = me.internalProfile || {};

  const saveAndClose = async () => {
    setSaving(true);
    const ok = await save.current?.();
    setSaving(false);
    if (ok) { setEditing(null); setMessage('Saved.'); reload(); }
  };

  const section = (title, key, badge, body) => (
    <Panel title={title} actions={<>{badge}<Button variant="secondary" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => { setMessage(''); setEditing(key); }}>Edit</Button></>}>{body}</Panel>
  );

  return (
    <InternalShell active="profile">
      <PageTop title="My profile"
        subtitle={<Meta parts={[`${me.fullName} · ${me.email}`, complete ? <Pill tone="ok">Complete</Pill> : <Pill tone="warn">Needs {[...(gaps.employment ? ['employment details'] : []), ...gaps.personal].join(', ').toLowerCase()}</Pill>]} />} />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      <div className="ws-grid-2">
        {section('UCAA employment', 'employment', check.tone ? <Pill tone={check.tone}>{check.tone === 'ok' ? `Verified by HR · ${formatDay(p.verifiedDate)}` : check.label}</Pill> : null, (
          <>
            <KeyValues rows={[
              ['Employee ID', p.employeeId || null], ['Position', p.position || null], ['Department', p.department || null],
              ['Joined UCAA', p.dateJoined ? formatDay(p.dateJoined) : null], ['Supervisor', p.supervisorName ? `${p.supervisorName}${p.supervisorEmail ? ` · ${p.supervisorEmail}` : ''}` : null]
            ]} />
            <div className="ws-note" style={{ marginTop: 8 }}>Changing these sends them back to HR to verify.</div>
          </>
        ))}
        {section('Personal details', 'personal', null, (
          <KeyValues rows={[
            ['National ID', me.nationalId ? <span className="ws-mono">{me.nationalId}</span> : null], ['District of origin', me.districtOfOrigin || null],
            ['Lives in', me.location || null], ['Date of birth', me.dateOfBirth ? formatDay(me.dateOfBirth) : null]
          ]} />
        ))}
        {section('Education', 'entries', null, (me.education || []).length ? (
          <table className="ws-table"><tbody>{me.education.map((e) => (
            <tr key={e.id}><td><span className="t">{e.qualificationLevelText || e.qualificationLevel}{e.fieldOfStudy ? ` in ${e.fieldOfStudy}` : ''}</span>
              <div className="s">{e.institution}{e.yearCompleted ? ` · ${e.yearCompleted}` : ''}{e.cgpa ? ` · CGPA ${e.cgpa}` : ''}</div></td></tr>
          ))}</tbody></table>
        ) : <span className="ws-note">No qualifications yet.</span>)}
        {section('Work experience', 'entries', null, (me.workExperience || []).length ? (
          <table className="ws-table"><tbody>{me.workExperience.map((w) => (
            <tr key={w.id}><td><span className="t">{w.jobTitle}</span>
              <div className="s">{w.employer} · {formatDay(w.startDate)} – {w.endDate ? formatDay(w.endDate) : 'now'}</div></td></tr>
          ))}</tbody></table>
        ) : <span className="ws-note">No jobs yet.</span>)}
        {section('Certificates', 'entries', null, (me.certificates || []).length ? (
          <table className="ws-table"><tbody>{me.certificates.map((c) => (
            <tr key={c.id}><td><span className="t">{c.name}</span>
              <div className="s">{c.issuingOrganization}{c.issueDate ? ` · ${formatDay(c.issueDate)}` : ''}{c.expiryDate ? ` · expires ${formatDay(c.expiryDate)}` : ''}</div></td></tr>
          ))}</tbody></table>
        ) : <span className="ws-note">None on file. Add any a vacancy asks for.</span>)}
        <Panel title="Your data"><YourDataCard bare /></Panel>
      </div>

      {editing && (
        <SidePanel wide={editing === 'entries'} onClose={() => setEditing(null)}
          title={{ employment: 'UCAA employment', personal: 'Personal details', entries: 'Education, experience and certificates' }[editing]}
          footer={editing === 'entries'
            ? <Button onClick={() => { setEditing(null); reload(); }}>Done</Button>
            : <><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} loadingText="Saving..." onClick={saveAndClose}>Save</Button></>}>
          {editing === 'employment' && (
            <>
              {check.tone === 'ok' && <Alert type="info" message="HR has verified these details. If you change them, HR checks them again before you can be shortlisted." />}
              <EmploymentForm me={me} bind={(fn) => { save.current = fn; }} />
            </>
          )}
          {editing === 'personal' && <PersonalForm me={me} bind={(fn) => { save.current = fn; }} />}
          {editing === 'entries' && <ProfileStep profile={me} onProfileChange={reload} showPersonalDetails={false} profileDetails={{}} setProfileDetail={() => () => {}} />}
        </SidePanel>
      )}
    </InternalShell>
  );
}
