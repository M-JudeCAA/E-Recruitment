import React from 'react';
import { useNavigate } from 'react-router-dom';
import Skeleton from '../../components/Skeleton';
import { offerAwaitingAnswer } from '../../components/offers/offerFormat';
import { Panel, Table, Pill } from '../../components/workspace/ui';
import { orgLabel } from '../../utils/orgNames';
import { SITE, stageOf, employmentCheck, formatDay, daysLeft } from './careers';

// The two lists the candidate pages show on more than one page (both sites, see SITE).

/** Open vacancies with "Your fit" from the eligibility check. */
export function VacancyFitTable({ vacancies, fit, applications, limit }) {
  const navigate = useNavigate();
  if (!vacancies) return <Panel><Skeleton width="60%" height={14} /></Panel>;
  const rows = limit ? vacancies.slice(0, limit) : vacancies;
  const mine = Object.fromEntries((applications || []).map((a) => [a.vacancyId, a]));
  return (
    <Panel padded={false}>
      <Table rows={rows} getRowKey={(v) => v.id} onRowClick={(v) => navigate(SITE.job(v.id))}
        emptyText={SITE.noJobs}
        columns={[
          { key: 'title', label: SITE.jobColumn, render: (v) => <><span className="t">{v.title}</span><div className="s ws-mono">{v.jobRef.replace('UCAA/ADV/', '')}</div></> },
          { key: 'dept', label: 'Department', render: (v) => { const [dept, dir] = orgLabel(v.department, '|').split('|'); return <>{dept}{dir && <div className="s">{dir}</div>}</>; } },
          { key: 'scale', label: 'Salary scale', render: (v) => <span className="s">{(v.salaryScale || '').split(/[ (]/)[0] || '—'}</span> },
          {
            key: 'closes', label: 'Closes', className: 'ws-num', render: (v) => {
              const left = daysLeft(v.deadline);
              return <>{formatDay(v.deadline, true) || '—'}{left != null && left <= 7 && <span className="ws-due soon"> {left <= 0 ? 'today' : `${left} day${left === 1 ? '' : 's'}`}</span>}</>;
            }
          },
          {
            key: 'fit', label: 'Your fit', render: (v) => {
              const f = fit?.[v.id];
              if (!f) return <span className="s">Checking…</span>;
              return f.eligible ? <Pill tone="ok">You meet the minimums</Pill> : <Pill tone="neutral">Not eligible</Pill>;
            }
          },
          {
            key: 'mine', label: '', align: 'right', render: (v) => {
              const a = mine[v.id];
              if (!a) return null;
              return <span className="s">{a.status === 'Draft' ? 'Draft started' : 'Applied'}</span>;
            }
          }
        ]} />
    </Panel>
  );
}

/** Vacancies whose deadline has passed, folded away under the open ones. */
export function ClosedVacancies({ vacancies }) {
  const navigate = useNavigate();
  if (!vacancies?.length) return null;
  const recent = [...vacancies].sort((a, b) => new Date(b.deadline) - new Date(a.deadline)).slice(0, 10);
  return (
    <details className="ws-panel ws-closed">
      <summary>Recently closed ({recent.length})</summary>
      <table className="ws-table"><tbody>
        {recent.map((v) => (
          <tr key={v.id} className="click" onClick={() => navigate(SITE.job(v.id))}>
            <td><span className="t">{v.title}</span><div className="s ws-mono">{v.jobRef.replace('UCAA/ADV/', '')}</div></td>
            <td className="s">{orgLabel(v.department)}</td>
            <td className="s ws-num">Closed {formatDay(v.deadline)}</td>
          </tr>
        ))}
      </tbody></table>
    </details>
  );
}

/** The candidate's applications, with the stage (and, on Internal Careers, the HR employment check). */
export function ApplicationsTable({ applications, me, onOpen }) {
  const navigate = useNavigate();
  return (
    <Panel padded={false}>
      <Table rows={applications || []} getRowKey={(a) => a.id}
        onRowClick={(a) => (onOpen ? onOpen(a) : navigate(`${SITE.applications}?open=${a.id}`))}
        emptyText="You haven’t applied for anything yet."
        columns={[
          { key: 'vacancy', label: SITE.jobColumn, render: (a) => <><span className="t">{a.vacancy.title}</span><div className="s ws-mono">{a.vacancy.jobRef.replace('UCAA/ADV/', '')}</div></> },
          { key: 'stage', label: 'Stage', render: (a) => { const s = stageOf(a); return <Pill tone={s.tone}>{s.label}</Pill>; } },
          SITE.internal && { key: 'check', label: 'Employment check', render: (a) => { const c = employmentCheck(me, a); return c.tone ? <Pill tone={c.tone}>{c.label}</Pill> : <span className="s">{c.label}</span>; } },
          { key: 'next', label: SITE.internal ? 'Next' : 'What happens next', render: (a) => <span className="s">{nextFor(a)}</span> }
        ].filter(Boolean)} />
    </Panel>
  );
}

function nextFor(a) {
  if (a.status === 'Draft') {
    const left = daysLeft(a.vacancy.deadline);
    return left != null && left < 0 ? 'Applications closed before it was sent' : `Finish and submit${a.vacancy.deadline ? ` · closes ${formatDay(a.vacancy.deadline, true)}` : ''}`;
  }
  if (offerAwaitingAnswer(a.offer)) return a.offer.responseDeadline ? `Answer the offer by ${formatDay(a.offer.responseDeadline)}` : 'Answer the offer';
  const round = (a.interviewRounds || []).filter((r) => r.status === 'Scheduled' && new Date(r.scheduledDate) > new Date())
    .sort((x, y) => new Date(x.scheduledDate) - new Date(y.scheduledDate))[0];
  if (round) {
    const when = new Date(round.scheduledDate).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return round.candidateResponse === 'Pending' ? `Confirm your interview: ${when}` : `Interview ${when}`;
  }
  if (['Rejected', 'Withdrawn'].includes(a.status) || a.offer) return '—';
  return 'HR is reviewing applications';
}
