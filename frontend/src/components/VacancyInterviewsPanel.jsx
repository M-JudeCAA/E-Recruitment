import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ArrowRight, ExternalLink } from 'lucide-react';
import Card from './Card';
import Button from './Button';
import Avatar from './Avatar';
import StatusBadge from './StatusBadge';
import InterviewScheduler from './interviews/InterviewScheduler';
import InterviewRoundPanel from './interviews/InterviewRoundPanel';
import { ROUND_LABELS, hintText } from './interviews/formStyles';
import { formatDateTime, venueLabel } from '../utils/interviews';

// Step two of selection, for one vacancy: everyone on the approved interview
// shortlist and where their interview stands - not booked, booked, awaiting
// scores, or decided - with scheduling and each round's workspace one click
// away. The Interview Hub remains the cross-vacancy view.

const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
const IN_SCOPE = ['Shortlisted', 'InterviewScheduled', 'Interviewed'];

function latestHeld(rounds = []) {
  return [...rounds].filter((r) => !['Cancelled', 'NoShow'].includes(r.status)).sort((a, b) => b.roundNumber - a.roundNumber)[0] || null;
}

// Where one candidate's interview stands, as a single phrase + badge.
function stageOf(app) {
  const round = latestHeld(app.interviewRounds);
  if (!round) return { key: 'unscheduled', label: 'Not scheduled', color: 'Pending' };
  if (round.recommendation) return { key: 'decided', label: round.recommendation, color: round.recommendation, round };
  const active = (round.panelMembers || []).filter((p) => !p.recusedAt);
  const scored = active.filter((p) => p.score != null).length;
  const started = round.scheduledDate && new Date(round.scheduledDate) <= new Date();
  if (!started) return { key: 'booked', label: 'Booked', color: 'Scheduled', round };
  if (active.length > 0 && scored === active.length) return { key: 'ready', label: 'Ready to finalize', color: 'Completed', round };
  return { key: 'scoring', label: `Scores ${scored}/${active.length}`, color: 'Pending', round };
}

export default function VacancyInterviewsPanel({ vacancy, applications, staffRole, onUpdated, onGoToMeritList }) {
  const canEdit = (ROLE_RANK[staffRole] || 0) >= ROLE_RANK.Senior_HR_Officer;
  const [scheduler, setScheduler] = useState(false);
  const [openRoundId, setOpenRoundId] = useState(null);

  const apps = applications.filter((a) => IN_SCOPE.includes(a.status))
    .map((a) => ({ app: a, stage: stageOf(a) }))
    .sort((x, y) => (x.app.rank ?? 1e9) - (y.app.rank ?? 1e9));
  const counts = apps.reduce((acc, { stage }) => ({ ...acc, [stage.key]: (acc[stage.key] || 0) + 1 }), {});
  const decided = counts.decided || 0;
  const allDecided = apps.length > 0 && decided === apps.length;
  const rejectedAtInterview = applications.filter((a) => a.status === 'Rejected' && a.interviewRounds?.some((r) => r.recommendation === 'Reject')).length;

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <strong style={{ fontSize: 16 }}>Interviews</strong>
            <div style={{ ...hintText, marginTop: 4 }}>
              {apps.length} on the interview shortlist · {counts.unscheduled || 0} not scheduled · {(counts.booked || 0) + (counts.scoring || 0) + (counts.ready || 0)} in progress · {decided} decided
              {rejectedAtInterview > 0 && ` · ${rejectedAtInterview} not recommended`}
            </div>
            {apps.length > 0 && (
              <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: 'var(--color-bg-subtle)', marginTop: 8, maxWidth: 360 }}>
                <div style={{ width: `${(decided / apps.length) * 100}%`, background: 'var(--color-accent)' }} />
                <div style={{ width: `${(((counts.booked || 0) + (counts.scoring || 0) + (counts.ready || 0)) / apps.length) * 100}%`, background: 'var(--color-primary)' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to={`/hr/interviews?tab=scorecards&vacancyId=${vacancy.id}`} style={{ fontSize: 13, alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Scorecard in Interview Hub <ExternalLink size={12} />
            </Link>
            {canEdit && counts.unscheduled > 0 && (
              <Button onClick={() => setScheduler(true)}><CalendarPlus size={14} /> Schedule interviews</Button>
            )}
          </div>
        </div>
      </Card>

      {decided > 0 && (
        <Card accent="var(--color-accent)">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>
              {allDecided
                ? 'Every interview has a verdict - rank the candidates on the merit list to decide who is offered the job.'
                : `${decided} candidate${decided === 1 ? ' has' : 's have'} a verdict. You can start the merit list now; the rest join it as their verdicts come in.`}
            </span>
            <Button variant={allDecided ? 'primary' : 'secondary'} onClick={onGoToMeritList}>Go to merit list <ArrowRight size={14} /></Button>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {apps.length === 0 && (
          <p style={{ margin: 0, padding: 16, color: 'var(--color-text-muted)' }}>
            Nobody is on an approved interview shortlist yet. Propose and approve one on the Shortlist step first.
          </p>
        )}
        {apps.map(({ app, stage }, i) => {
          const round = stage.round;
          return (
            <div key={app.id} className="list-row" style={{
              display: 'grid', gridTemplateColumns: '32px minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
              padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)'
            }}>
              <span style={{ ...hintText, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{app.rank ? `#${app.rank}` : ''}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Avatar name={app.candidate.fullName} size={24} />
                  <strong style={{ fontSize: 14 }}>{app.candidate.fullName}</strong>
                  <span style={hintText}>{app.candidate.candidateType}</span>
                  <StatusBadge status={stage.color} label={stage.label} />
                  {app.meritListStatus && <StatusBadge status={app.meritListStatus} label={`Merit #${app.meritRank} · ${app.meritListStatus}`} />}
                </div>
                <div style={{ ...hintText, marginTop: 4 }}>
                  {round
                    ? <>Round {round.roundNumber} · {formatDateTime(round.scheduledDate)} · {venueLabel(round)}
                      {round.score != null && <> · score <strong>{round.score}</strong></>}
                      {round.status === 'Scheduled' && round.candidateResponse && <> · candidate: {ROUND_LABELS[round.candidateResponse] || round.candidateResponse}</>}</>
                    : 'No interview booked yet'}
                </div>
              </div>
              <div>
                {round && <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => setOpenRoundId(round.id)}>Open</Button>}
              </div>
            </div>
          );
        })}
      </Card>

      {scheduler && (
        <InterviewScheduler presetVacancyId={vacancy.id} onClose={() => setScheduler(false)} onScheduled={onUpdated} />
      )}
      {openRoundId && (
        <InterviewRoundPanel roundId={openRoundId} onClose={() => setOpenRoundId(null)} onChanged={onUpdated} />
      )}
    </div>
  );
}
