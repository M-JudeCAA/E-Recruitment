import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import staffClient from '../../models/staffApiClient';
import Button from '../Button';
import Alert from '../Alert';
import Spinner from '../Spinner';
import ReasonDialog from '../ReasonDialog';
import OfferSummary from '../offers/OfferSummary';
import OfferActions from '../offers/OfferActions';
import { useConfirm } from '../ConfirmDialog';
import { approveVacancy } from '../../utils/approveVacancy';
import { SidePanel, KeyValues, Pill, formatDay } from './ui';

// The Inbox's "Review" side panel: one approval, its facts, and the decision
// buttons at the bottom - so an approver never has to leave the list. One
// shape per approval type the Inbox hands over (inboxService review.type):
//   vacancy    approve / return / reject (approveVacancy asks about any exception)
//   offer      the terms, with OfferActions' approve & issue / return
//   committee  the nominated members, approve / return (Directors)
//   department approve / reject
// onDone(message) closes the panel and refreshes the Inbox.
export default function ReviewPanel({ item, staffRole, onClose, onDone }) {
  const { review } = item;
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null); // 'return' | 'reject'

  useEffect(() => {
    setError('');
    const load = {
      vacancy: () => staffClient.get(`/api/vacancies/${review.vacancyId}`).then((r) => r.data),
      offer: () => staffClient.get('/api/applications/offers/pending-approval', { params: { page: 1, limit: 100 } })
        .then((r) => (r.data.data || []).find((o) => o.id === review.offerId) || null),
      committee: () => staffClient.get('/api/shortlist-committee/nominations/pending')
        .then((r) => (r.data || []).find((c) => c.vacancy.id === review.vacancyId) || null),
      department: () => Promise.resolve(review)
    }[review.type];
    load().then((d) => {
      if (!d) setError('This is no longer waiting for a decision.');
      setData(d);
    }).catch((err) => setError(err.response?.data?.error || 'Could not load this item'));
  }, [review]);

  const run = async (fn, message) => {
    setBusy(true); setError('');
    try {
      const ok = await fn();
      if (ok !== false) onDone(message);
    } catch (err) {
      setError(err.response?.data?.error || 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  let body = null;
  let footer = null;
  let reasonDialog = null;

  if (review.type === 'vacancy' && data) {
    const v = data;
    const exceptions = [
      v.requisitionDetails?.jdException && 'The job description is not approved - you will be asked to authorise the exception.',
      v.requisitionDetails?.headcountException && 'It goes above the approved headcount - only a Director can authorise that.'
    ].filter(Boolean);
    body = (
      <>
        <KeyValues rows={[
          ['Job reference', <span className="ws-mono">{v.jobRef}</span>],
          ['Department', `${v.department?.name || ''}${v.department?.directorate?.name ? `, ${v.department.directorate.name}` : ''}`],
          ['Posting', v.postingType],
          ['Posts', v.positionsRequired],
          ['Applications close', v.deadline ? formatDay(v.deadline) : null],
          ['Salary scale', v.salaryScale || null],
          ['Raised by', v.createdBy?.name || null],
          ['Requisition', v.requisitionDetails?.excoReference || v.requisitionDetails?.fields?.excoReference || (v.requisitionDocumentName || null)]
        ]} />
        {exceptions.map((e) => <Alert key={e} type="warning" message={e} />)}
        <div><Link to={`/hr/vacancy/${v.id}`} onClick={onClose}>Open the vacancy</Link> to read the full advert and requisition.</div>
      </>
    );
    footer = (
      <>
        <Button variant="ghost" style={{ color: 'var(--color-danger)' }} disabled={busy} onClick={() => setAsking('reject')}>Reject</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAsking('return')}>Return for changes</Button>
        <Button loading={busy} loadingText="Approving..." onClick={() => run(async () => Boolean(await approveVacancy(v.id, confirm)), 'Vacancy approved and advertised. Its creator has been told.')}>Approve</Button>
      </>
    );
    if (asking) {
      reasonDialog = (
        <ReasonDialog
          title={`${asking === 'return' ? 'Return' : 'Reject'} vacancy — ${v.jobRef}`}
          intro={asking === 'return' ? 'HR sees your comment, changes the vacancy and resubmits it.' : 'Rejecting is final. HR sees your reason.'}
          label={asking === 'return' ? 'What needs to change' : 'Reason'}
          confirmLabel={asking === 'return' ? 'Return for changes' : 'Reject vacancy'}
          danger={asking === 'reject'}
          onClose={() => setAsking(null)}
          onSubmit={async (reason) => {
            await staffClient.patch(`/api/vacancies/${v.id}/${asking}`, { reason });
            setAsking(null);
            onDone(asking === 'return' ? 'Vacancy returned to HR.' : 'Vacancy rejected.');
          }}
        />
      );
    }
  }

  if (review.type === 'offer' && data) {
    body = (
      <>
        <KeyValues rows={[
          ['Candidate', data.application.candidate.fullName],
          ['Vacancy', `${data.application.vacancy.title} (${data.application.vacancy.jobRef})`],
          ['Merit list', data.application.meritRank ? `#${data.application.meritRank} ${data.application.meritListStatus || ''}` : null],
          ['Recommended by', data.recommendedBy?.name || 'HR']
        ]} />
        <OfferSummary offer={data} />
        <OfferActions offer={data} applicationId={data.application.id} staffRole={staffRole} onChanged={() => onDone('Offer updated.')} />
      </>
    );
  }

  if (review.type === 'committee' && data) {
    body = (
      <>
        <KeyValues rows={[
          ['Vacancy', `${data.vacancy.title} (${data.vacancy.jobRef})`],
          ['Submitted by', data.submittedBy?.name || 'HR'],
          ['Submitted', data.submittedAt ? formatDay(data.submittedAt) : null]
        ]} />
        <div>
          <h3>Nominated members</h3>
          <table className="ws-table"><tbody>
            {data.members.map((m) => (
              <tr key={m.id || m.email || m.name}>
                <td><span className="t">{m.name}</span>{m.externalReason && <div className="s">From outside UCAA: {m.externalReason}</div>}</td>
                <td className="r">{m.isChair && <Pill tone="brand">Chair</Pill>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div><Link to={`/hr/vacancy/${data.vacancy.id}?tab=committee`} onClick={onClose}>Change the members</Link> on the vacancy’s Committee tab before approving, if needed.</div>
      </>
    );
    footer = (
      <>
        <Button variant="secondary" disabled={busy} onClick={() => setAsking('return')}>Return to HR</Button>
        <Button loading={busy} loadingText="Approving..." onClick={() => run(() => staffClient.post(`/api/shortlist-committee/vacancies/${data.vacancy.id}/nomination/approve`), 'Committee approved. HR can open rating.')}>Approve committee</Button>
      </>
    );
    if (asking) {
      reasonDialog = (
        <ReasonDialog title={`Return the committee for ${data.vacancy.jobRef}`} intro="HR will see your reason, change the members and submit again."
          confirmLabel="Return" onClose={() => setAsking(null)}
          onSubmit={async (reason) => {
            await staffClient.post(`/api/shortlist-committee/vacancies/${data.vacancy.id}/nomination/return`, { reason });
            setAsking(null);
            onDone('Committee returned to HR.');
          }} />
      );
    }
  }

  if (review.type === 'department' && data) {
    body = (
      <KeyValues rows={[['Department', data.name], ['Directorate', data.directorate], ['Proposed by', item.context.replace(/^Proposed by /, '').replace(/\.$/, '')]]} />
    );
    footer = (
      <>
        <Button variant="ghost" style={{ color: 'var(--color-danger)' }} disabled={busy} onClick={() => setAsking('reject')}>Reject</Button>
        <Button loading={busy} loadingText="Approving..." onClick={() => run(() => staffClient.patch(`/api/departments/${data.departmentId}/approve`), 'Department approved.')}>Approve</Button>
      </>
    );
    if (asking) {
      reasonDialog = (
        <ReasonDialog title={`Reject department — ${data.name}`} label="Reason" confirmLabel="Reject department" danger
          onClose={() => setAsking(null)}
          onSubmit={async (reason) => {
            await staffClient.patch(`/api/departments/${data.departmentId}/reject`, { reason });
            setAsking(null);
            onDone('Department rejected.');
          }} />
      );
    }
  }

  return (
    <>
      <SidePanel title={item.title} eyebrow={<>{item.kind}{item.due && <> · <span className={`ws-due${item.overdue ? ' over' : ''}`}>{item.due}</span></>}</>}
        onClose={onClose} footer={data ? footer : null}>
        <Alert type="error" message={error} />
        {!data && !error && <div className="ws-empty"><Spinner size={18} /></div>}
        {body}
      </SidePanel>
      {reasonDialog}
    </>
  );
}
