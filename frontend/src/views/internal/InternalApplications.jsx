import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import client from '../../models/apiClient';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Skeleton from '../../components/Skeleton';
import CandidateInterviewCard from '../../components/interviews/CandidateInterviewCard';
import CandidateOfferPanel from '../../components/offers/CandidateOfferPanel';
import { useConfirm } from '../../components/ConfirmDialog';
import { PageTop, SidePanel, Pill } from '../../components/workspace/ui';
import { InternalShell, useCareer, stageOf, employmentCheck, formatDay, daysLeft } from './careers';
import { ApplicationsTable } from './tables';

// My applications on Internal Careers (/careers/applications): every
// application with its stage and HR's employment check. A row opens its
// progress in a side panel, with the interview (confirm, ask for another
// time, add to calendar) and an issued offer to accept or decline.
// ?open=<id> opens one straight away (links from Home).

function trackOf(app, me) {
  const p = me?.internalProfile;
  const verified = p?.verificationStatus === 'HR_Verified';
  const flagged = p?.verificationStatus === 'Discrepancy_Flagged';
  const rounds = (app.interviewRounds || []).filter((r) => r.status !== 'Cancelled');
  const reached = (s) => ['Shortlisted', 'InterviewScheduled', 'Interviewed', 'Offered'].includes(s) || Boolean(app.offer);
  const t = [];
  if (app.status === 'Draft') {
    return [['now', 'Draft', `Not sent yet${app.vacancy.deadline ? ` · applications close ${formatDay(app.vacancy.deadline)}` : ''}`],
      ['todo', 'Submitted'], ['todo', 'Employment details verified by HR'], ['todo', 'Shortlisting'], ['todo', 'Interview'], ['todo', 'Offer']];
  }
  t.push(['done', 'Submitted', formatDay(app.submittedDate)]);
  t.push(verified ? ['done', 'Employment details verified by HR', formatDay(p.verifiedDate)]
    : flagged ? ['bad', 'Your employment details don’t match HR’s records', 'HR will contact you']
      : ['wait', 'Employment details verified by HR', 'HR is checking']);
  if (app.status === 'Withdrawn') return [...t, ['done', 'You withdrew this application', '']];
  if (app.status === 'Rejected' && !reached(app.status)) return [...t, ['done', 'Not taken forward', app.rejectionReason || '']];
  t.push(reached(app.status) ? ['done', 'Shortlisted for interview', ''] : ['now', 'Shortlisting', 'HR and the committee are reviewing applications']);
  if (rounds.length) {
    const upcoming = rounds.find((r) => r.status === 'Scheduled' && new Date(r.scheduledDate) > new Date());
    const held = rounds.some((r) => r.status === 'Held');
    t.push(upcoming ? ['now', 'Interview', new Date(upcoming.scheduledDate).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })]
      : held ? ['done', 'Interviewed', ''] : ['todo', 'Interview']);
  } else if (reached(app.status)) t.push(['todo', 'Interview', 'HR will invite you']);
  if (app.status === 'Rejected') return [...t, ['done', 'Not taken forward', app.rejectionReason || '']];
  if (app.offer) {
    const s = app.offer.status;
    t.push(s === 'Accepted' ? ['done', 'Offer accepted', formatDay(app.offer.decidedAt)]
      : ['Approved', 'Extended'].includes(s) ? ['now', 'Offer', app.offer.responseDeadline ? `Answer by ${formatDay(app.offer.responseDeadline)}` : 'Accept or decline it']
        : ['done', `Offer ${s.toLowerCase()}`, '']);
  } else t.push(['todo', 'Offer']);
  return t;
}

export default function InternalApplications() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const { me, applications, error, reload } = useCareer();
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState('');
  const openId = Number(params.get('open')) || null;
  const open = (applications || []).find((a) => a.id === openId);
  const setOpen = (id) => { const next = new URLSearchParams(params); if (id) next.set('open', id); else next.delete('open'); setParams(next, { replace: true }); };

  const respondToOffer = async (offerId, action, reason) => {
    setBusy(action);
    try {
      await client.patch(`/api/applications/offers/${offerId}/${action}`, action === 'decline' ? { reason: reason || undefined } : undefined);
      setMessage(action === 'accept' ? 'Offer accepted. Congratulations!' : 'Offer declined.');
      await reload();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not record your answer');
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async (app) => {
    const draft = app.status === 'Draft';
    if (!(await confirm(draft ? 'Delete this draft? You can start a new application for this vacancy afterwards.' : 'Withdraw this application? You can’t apply for this vacancy again.',
      { title: draft ? 'Delete draft' : 'Withdraw application', confirmLabel: draft ? 'Delete draft' : 'Withdraw', danger: true }))) return;
    try {
      await client.patch(`/api/applications/${app.id}/withdraw`);
      setOpen(null);
      setMessage(draft ? 'Draft deleted.' : 'Application withdrawn.');
      reload();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Could not withdraw it');
    }
  };

  const stage = open && stageOf(open);
  const check = open && employmentCheck(me, open);
  const left = open && daysLeft(open.vacancy.deadline);
  return (
    <InternalShell active="applications">
      <PageTop title="My applications" subtitle="Every application, where it stands, and what happens next" />
      <Alert type="error" message={error} />
      <Alert type="success" message={message} />
      {!applications ? <Skeleton height={160} /> : <ApplicationsTable applications={applications} me={me} onOpen={(a) => setOpen(a.id)} />}

      {open && (
        <SidePanel title={open.vacancy.title} eyebrow={<span className="ws-mono">{open.vacancy.jobRef}</span>}
          badges={<><Pill tone={stage.tone}>{stage.label}</Pill>{check.tone && <Pill tone={check.tone}>{check.label}</Pill>}</>}
          onClose={() => setOpen(null)}
          footer={open.status === 'Draft' ? (
            <>
              <Button variant="ghost" style={{ color: 'var(--color-danger)' }} onClick={() => withdraw(open)}>Delete draft</Button>
              {(left == null || left >= 0) && <Button onClick={() => navigate(`/careers/apply/${open.vacancyId}`)}>Continue</Button>}
            </>
          ) : ['Submitted', 'UnderReview', 'Shortlisted', 'InterviewScheduled', 'Interviewed'].includes(open.status) && !open.offer ? (
            <Button variant="ghost" style={{ color: 'var(--color-danger)' }} onClick={() => withdraw(open)}>Withdraw application</Button>
          ) : null}>
          <div>
            <h3>Progress</h3>
            <ol className="ws-track">
              {trackOf(open, me).map(([state, label, when], i) => (
                <li key={i} className={state}>
                  <span className="dot">{state === 'done' ? '✓' : state === 'wait' ? '…' : state === 'bad' ? '!' : ''}</span>
                  <div><b style={{ fontWeight: 500 }}>{label}</b>{when && <div className="when">{when}</div>}</div>
                </li>
              ))}
            </ol>
          </div>
          {(open.interviewRounds || []).length > 0 && (
            <div>
              <h3>Interview</h3>
              {open.interviewRounds.slice().sort((a, b) => a.roundNumber - b.roundNumber)
                .map((round) => <CandidateInterviewCard key={round.id} round={round} onChanged={reload} />)}
            </div>
          )}
          {open.offer && (
            <div>
              <h3>Offer</h3>
              <CandidateOfferPanel offer={open.offer} jobTitle={open.vacancy.title} busy={busy} onRespond={(action, reason) => respondToOffer(open.offer.id, action, reason)} />
            </div>
          )}
        </SidePanel>
      )}
    </InternalShell>
  );
}
