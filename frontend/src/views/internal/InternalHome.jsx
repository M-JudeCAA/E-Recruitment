import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import ReasonDialog from '../../components/ReasonDialog';
import { PageTop, Meta, Pill } from '../../components/workspace/ui';
import { InternalShell, useCareer, profileGaps, employmentCheck, interviewsToConfirm, formatDay, daysLeft } from './careers';
import { VacancyFitTable, ApplicationsTable } from './tables';

// Internal Careers home (/careers): what needs the employee now - an
// interview to confirm, an offer to answer, a draft to finish, a profile to
// complete - then the open internal vacancies, each checked against their
// profile, and their applications.
export default function InternalHome() {
  const navigate = useNavigate();
  const { me, applications, vacancies, fit, error, reload } = useCareer({ fitFor: 'open' });
  const [asking, setAsking] = useState(null);
  const [message, setMessage] = useState('');

  if (me && !me.internalProfile?.employeeId && !(applications || []).length) return <Navigate to="/careers/welcome" replace />;

  const respond = async (round, response, note) => {
    await client.patch(`/api/candidates/me/interviews/${round.id}/respond`, { response, note });
    setMessage(response === 'Confirmed' ? 'Interview confirmed.' : 'HR has been asked for another time.');
    setAsking(null);
    reload();
  };

  const gaps = profileGaps(me);
  const tasks = [];
  interviewsToConfirm(applications).forEach(({ app, round }) => tasks.push(
    <div key={`iv-${round.id}`} className="ws-task">
      <div className="kind">Interview to confirm</div>
      <div className="what"><b>{app.vacancy.title}</b><div>{new Date(round.scheduledDate).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{round.venue ? ` · ${round.venue}` : ''}</div></div>
      <Button variant="ghost" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => setAsking(round)}>Ask for another time</Button>
      <Button style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => respond(round, 'Confirmed')}>Confirm</Button>
    </div>
  ));
  (applications || []).filter((a) => a.offer && ['Approved', 'Extended'].includes(a.offer.status)).forEach((a) => tasks.push(
    <div key={`of-${a.id}`} className="ws-task over">
      <div className="kind">Offer to answer</div>
      <div className="what"><b>{a.vacancy.title}</b><div>{a.offer.responseDeadline ? `Answer by ${formatDay(a.offer.responseDeadline)}` : 'Accept or decline it'}</div></div>
      <span />
      <Button style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => navigate(`/careers/applications?open=${a.id}`)}>Open</Button>
    </div>
  ));
  (applications || []).filter((a) => a.status === 'Draft' && (daysLeft(a.vacancy.deadline) ?? 1) >= 0).forEach((a) => {
    const left = daysLeft(a.vacancy.deadline);
    tasks.push(
      <div key={`dr-${a.id}`} className="ws-task">
        <div className="kind">Draft application</div>
        <div className="what"><b>{a.vacancy.title}</b><div>Not submitted yet{a.vacancy.deadline ? ` · applications close ${formatDay(a.vacancy.deadline)}` : ''}</div></div>
        {left != null ? <span className={`ws-due${left <= 3 ? ' soon' : ''}`}>{left <= 0 ? 'closes today' : `${left} day${left === 1 ? '' : 's'} left`}</span> : <span />}
        <Button variant="secondary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => navigate(`/careers/apply/${a.vacancyId}`)}>Continue</Button>
      </div>
    );
  });
  if (me && (gaps.employment || gaps.personal.length)) tasks.push(
    <div key="profile" className="ws-task">
      <div className="kind">Profile</div>
      <div className="what"><b>Finish your profile</b><div>Still needed: {[...(gaps.employment ? ['employment details'] : []), ...gaps.personal].join(', ')}</div></div>
      <span />
      <Button variant="secondary" style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => navigate('/careers/profile')}>Open</Button>
    </div>
  );

  const check = employmentCheck(me);
  const firstName = (me?.fullName || '').split(' ')[0];
  const hour = new Date().getHours();
  return (
    <InternalShell active="home">
      <PageTop
        title={`${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`}
        subtitle={me && <Meta parts={[
          me.internalProfile?.position && `${me.internalProfile.position}${me.internalProfile.department ? ` · ${me.internalProfile.department}` : ''}`,
          check.tone === 'ok' ? <Pill tone="ok">Employment verified by HR</Pill> : check.tone === 'bad' ? <Pill tone="bad">Employment details don’t match HR records</Pill> : null
        ]} />}
      />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />

      {!me ? <Skeleton height={120} /> : tasks.length > 0 && (
        <section className="ws-group"><h3>Needs you</h3><div className="ws-panel">{tasks}</div></section>
      )}

      <section className="ws-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Open internal vacancies</h3><Link to="/careers/vacancies">All vacancies</Link>
        </div>
        <VacancyFitTable vacancies={vacancies} fit={fit} applications={applications} limit={6} />
      </section>

      {(applications || []).length > 0 && (
        <section className="ws-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Your applications</h3><Link to="/careers/applications">All applications</Link>
          </div>
          <ApplicationsTable applications={applications.slice(0, 4)} me={me} />
        </section>
      )}

      {asking && (
        <ReasonDialog title="Ask for another time" intro="HR sees your note and suggests a new time."
          label="Why, and when suits you" confirmLabel="Send" onClose={() => setAsking(null)}
          onSubmit={(note) => respond(asking, 'RescheduleRequested', note)} />
      )}
    </InternalShell>
  );
}
