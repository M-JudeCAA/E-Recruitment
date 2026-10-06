import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import { useDashboardEvents } from '../models/dashboardSocket';
import { refreshInbox } from '../models/useInbox';
import HRSidebar from '../components/HRSidebar';
import Button from '../components/Button';
import Alert from '../components/Alert';
import Skeleton from '../components/Skeleton';
import Card from '../components/Card';
import HiringManagerPicker from '../components/HiringManagerPicker';
import AuditTrail from '../components/AuditTrail';
import ApplicationReviewCard from '../components/ApplicationReviewCard';
import ShortlistCommittee from '../components/ShortlistCommittee';
import ShortlistPipelineBoard from '../components/ShortlistPipelineBoard';
import VacancyInterviewsPanel from '../components/VacancyInterviewsPanel';
import MeritListBoard from '../components/MeritListBoard';
import VacancyActions from '../components/workspace/VacancyActions';
import ApplicantsTable from '../components/workspace/ApplicantsTable';
import { PageTop, Meta, Panel, KeyValues, Pill, SidePanel, formatDay, rankOf, ROLE_RANK, currentStaffId } from '../components/workspace/ui';
import { useConfirm } from '../components/ConfirmDialog';
import { approveVacancy } from '../utils/approveVacancy';
import { useGeneratedCvDownload } from '../utils/useGeneratedCvDownload';
import { fileLink } from '../utils/fileLink';
import { debounce } from '../utils/debounce';

// One page per vacancy (/hr/vacancy/:id?tab=...): the header carries every
// action on it (VacancyActions), the Next step box says what happens next
// and who does it, the step bar mirrors the process (each step opens its
// tab), and the tabs hold the work itself:
//   Overview              job details, requisition, hiring manager, headcount
//   Applicants            everyone, by stage, with bulk email / not progressing
//   Committee             begin review, the shortlisting committee, the interview shortlist
//   Interviews & EXCO     EXCO's approval of the shortlist, scheduling, results
//   Merit list & offers   the merit list, offers and marking as hired
//   History               the vacancy's audit trail
// Any candidate opens in a side panel with the full application. Progress
// comes from GET /api/vacancies/:id/progress (vacancyProgressService).

const TABS = [
  ['overview', 'Overview'], ['applicants', 'Applicants'], ['committee', 'Committee'],
  ['interviews', 'Interviews & EXCO'], ['merit', 'Merit list & offers'], ['history', 'History']
];

// Who acts on a step (vacancyProgressService next.role) - mirrors inboxService.inAudience.
function canTakeStep(role, staffRole) {
  if (!role) return false;
  const rank = rankOf(staffRole);
  const base = ROLE_RANK[role];
  return rank >= base && rank <= (role === 'Manager' ? ROLE_RANK.Director : base + 1);
}

const ACTION_LABELS = {
  resubmitVacancy: 'Edit and resubmit', approveCommittee: 'Review committee', reviseCommittee: 'Change the committee',
  committeeSetup: 'Set up the committee', openRating: 'Open rating', proposeShortlist: 'Propose shortlist',
  approveShortlist: 'Review the shortlist', beginReview: 'Begin review', attachExco: 'Attach EXCO approval',
  scheduleInterviews: 'Schedule interviews', recordResults: 'Record results', proposeMerit: 'Propose merit list',
  approveMerit: 'Review the merit list', draftOffer: 'Draft offer', reviseOffer: 'Revise offer',
  approveOffer: 'Review offers', markHired: 'Mark as hired', noApplicants: 'Readvertise or close'
};

const REQUISITION_FACTS = [
  ['excoReference', 'EXCO approval'], ['approvalDate', 'Date of approval'], ['positionStatus', 'Position status'],
  ['jdStatus', 'JD status'], ['contractDuration', 'Contract duration'], ['expectedReportingDate', 'Expected reporting date'],
  ['section', 'Section'], ['directReports', 'No. of direct reports'], ['equipment', 'Required items/equipment']
];
const EDITED_LABELS = {
  positionId: 'job title', reportsToPositionId: 'reports to', positionsRequired: 'number of vacancies', postingType: 'posting type',
  salaryScale: 'salary scale', location: 'location', employmentCategory: 'employment category', minimumAge: 'minimum age',
  maximumAge: 'maximum age', jobPurpose: 'job purpose', essentialRequirements: 'essential requirements',
  desirableQualifications: 'desirable requirements', generalKnowledge: 'knowledge', specialSkills: 'special skills'
};
const EMPLOYMENT = { FullTime: 'Permanent, full time', Contract: 'Contract', FixedTermContract: 'Fixed-term contract' };

function RequisitionPanel({ vacancy }) {
  if (!vacancy.requisitionDocumentUrl) {
    return <Panel title="Requisition"><div className="ws-note">Created before vacancies required an uploaded requisition.</div></Panel>;
  }
  const details = vacancy.requisitionDetails || {};
  const fields = details.fields || {};
  const facts = REQUISITION_FACTS.filter(([key]) => fields[key]?.value);
  const edited = (details.editedFields || []).map((k) => EDITED_LABELS[k] || k);
  return (
    <Panel title="Requisition">
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <a href={fileLink(vacancy.requisitionDocumentUrl)} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>{vacancy.requisitionDocumentName || 'Requisition document'}</a>
          {vacancy.requisitionUploadedAt && <span className="ws-note"> · uploaded {formatDay(vacancy.requisitionUploadedAt)}</span>}
        </div>
        <div>
          Signed copy:{' '}
          {vacancy.requisitionSignedCopyUrl
            ? <a href={fileLink(vacancy.requisitionSignedCopyUrl)} target="_blank" rel="noreferrer" style={{ overflowWrap: 'anywhere' }}>{vacancy.requisitionSignedCopyName || 'Signed requisition'}</a>
            : <span className="ws-note">none - created before the signed scan was required</span>}
        </div>
        {facts.length > 0 && <KeyValues rows={facts.map(([key, label]) => [label, String(fields[key].value)])} />}
        {details.jdException && (
          <div className="ws-note" style={{ color: 'var(--color-warning)' }}>
            Job description not approved. Reason given: {details.jdException.reason}
            {details.jdException.authorisedAt ? ` - exception authorised ${formatDay(details.jdException.authorisedAt)}.` : ' - waiting for the approver to authorise it.'}
          </div>
        )}
        {details.headcountException && (
          <div className="ws-note" style={{ color: 'var(--color-warning)' }}>
            Above the approved headcount. Reason given: {details.headcountException.reason}
            {details.headcountException.authorisedAt ? ` - authorised ${formatDay(details.headcountException.authorisedAt)}.` : ' - a Director authorises it at approval.'}
          </div>
        )}
        {edited.length > 0 && <div className="ws-note">Changed from the requisition when the vacancy was created: {edited.join(', ')}.</div>}
      </div>
    </Panel>
  );
}

function HeadcountPanel({ vacancy }) {
  const [data, setData] = useState(undefined);
  useEffect(() => {
    if (!vacancy.positionId) { setData(null); return; }
    staffClient.get(`/api/positions/${vacancy.positionId}/headcount`).then((r) => setData(r.data)).catch(() => setData(null));
  }, [vacancy.positionId]);
  if (data === undefined) return null;
  return (
    <Panel title="Headcount">
      {data?.headcount != null
        ? <>{data.headcount} approved · {data.occupied ?? 0} filled · {Math.max(data.available ?? 0, 0)} free · {vacancy.positionsRequired} on this vacancy</>
        : <span className="ws-note">No approved headcount recorded for this position (Organisation).</span>}
    </Panel>
  );
}

export default function VacancyWorkspace() {
  const { id } = useParams();
  const confirm = useConfirm();
  const { staff } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const setTab = (key) => {
    const next = new URLSearchParams(searchParams);
    if (key === 'overview') next.delete('tab'); else next.set('tab', key);
    setSearchParams(next, { replace: false });
  };

  const [vacancy, setVacancy] = useState(null);
  const [progress, setProgress] = useState(null);
  const [apps, setApps] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [committeeManaged, setCommitteeManaged] = useState(false);
  const [openAppId, setOpenAppId] = useState(null);
  const [beginning, setBeginning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [hmError, setHmError] = useState('');
  const { download: downloadCv, hiddenPrintArea, downloadingId } = useGeneratedCvDownload();

  const requestId = useRef(0);
  const load = useCallback(() => {
    const mine = ++requestId.current;
    setReloadKey((k) => k + 1);
    staffClient.get(`/api/vacancies/${id}`)
      .then((r) => { if (requestId.current === mine) setVacancy(r.data); })
      .catch((err) => { if (requestId.current === mine) setLoadError(err.response?.data?.error || 'Could not load this vacancy'); });
    staffClient.get(`/api/vacancies/${id}/progress`)
      .then((r) => { if (requestId.current === mine) setProgress(r.data); })
      .catch(() => {});
    staffClient.get(`/api/vacancies/${id}/applications`)
      .then((r) => { if (requestId.current === mine) setApps(r.data); })
      .catch(() => { if (requestId.current === mine) setApps([]); });
  }, [id]);
  useEffect(() => { setVacancy(null); setProgress(null); setLoadError(''); load(); }, [load]);
  const refetch = useRef(debounce(() => load(), 500));
  useEffect(() => { refetch.current = debounce(() => load(), 500); }, [load]);
  useDashboardEvents((...args) => refetch.current(...args));

  const changed = (text, failure) => {
    if (failure) { setError(failure); return; }
    setError(''); if (text) setMessage(text);
    load(); refreshInbox();
  };

  const saveHiringManager = async (hiringManager) => {
    setHmError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}`, { hiringManager });
      load();
    } catch (err) {
      setHmError(err.response?.data?.error || (err.response?.data?.errors || []).join('; ') || 'Could not save the hiring manager');
    }
  };

  const beginReview = async () => {
    setBeginning(true); setError('');
    try {
      await staffClient.patch(`/api/vacancies/${id}/begin-review`);
      changed('Review started - every application has been screened.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not begin review');
    } finally {
      setBeginning(false);
    }
  };

  if (loadError) {
    return (
      <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
        <HRSidebar active="vacancies" />
        <div className="ws-page" style={{ flex: 1 }}><Alert type="error" message={loadError} /></div>
      </div>
    );
  }

  const v = vacancy;
  const next = progress?.next;
  const isApprover = rankOf(staff?.role) >= ROLE_RANK.Manager;
  const unpublished = v && ['PendingApproval', 'Returned', 'Rejected'].includes(v.status);
  const deadlinePassed = v?.deadline && new Date(v.deadline) < new Date();
  const openApp = apps.find((a) => a.id === openAppId);
  const canBeginReview = rankOf(staff?.role) >= ROLE_RANK.Senior_HR_Officer && apps.some((a) => a.status === 'Submitted') && !unpublished;

  let primary = null;
  if (v && v.status === 'PendingApproval' && isApprover && v.createdById !== currentStaffId()) {
    primary = (
      <Button loading={approving} loadingText="Approving..." onClick={async () => {
        setApproving(true); setError('');
        try { if (await approveVacancy(v.id, confirm)) changed('Approved and advertised. Its creator has been told.'); }
        catch (err) { setError(err.response?.data?.error || 'Approval failed'); }
        finally { setApproving(false); }
      }}>Approve</Button>
    );
  } else if (next && canTakeStep(next.role, staff?.role) && !next.excludeStaffIds?.includes(currentStaffId()) && next.kind !== 'approveVacancy') {
    primary = <Button onClick={() => (next.kind === 'beginReview' ? beginReview() : setTab(next.tab))} loading={beginning}>{ACTION_LABELS[next.kind] || 'Open'}</Button>;
  }

  const body = !v ? null : {
    overview: () => (
      <div className="ws-grid-main">
        <Panel title="Job details">
          <KeyValues rows={[
            ['Job title', v.title],
            ['Department', `${v.department?.name || ''}${v.department?.directorate?.name ? `, ${v.department.directorate.name}` : ''}`],
            ['Reports to', v.reportsToPosition?.name || null],
            ['Salary scale', v.salaryScale || null],
            ['Duty station', v.location || null],
            ['Employment', EMPLOYMENT[v.employmentCategory] || v.employmentCategory || null],
            ['Posts', v.positionsRequired],
            ['Posting', v.postingType],
            ['Applications', v.deadline ? `${deadlinePassed ? 'Closed' : 'Close'} ${formatDay(v.deadline)}` : null],
            ['Raised', v.createdBy?.name ? `${formatDay(v.createdAt)} by ${v.createdBy.name}` : formatDay(v.createdAt)],
            ['Approved', v.approvedAt ? `${formatDay(v.approvedAt)}${v.approvedBy?.name ? ` by ${v.approvedBy.name}` : ''}` : (v.status === 'PendingApproval' ? <span className="ws-note">Waiting for approval</span> : null)],
            ['Internal salary range', v.internalSalaryRange || null],
            ['Notes for recruiters', v.recruiterNotes || null]
          ]} />
        </Panel>
        <div className="ws-stack">
          <RequisitionPanel vacancy={v} />
          <Panel title="Hiring manager" note="Emailed at each step: advertised, shortlist, interviews, merit list, offers.">
            <HiringManagerPicker
              value={v.hiringManagerEmail ? { name: v.hiringManagerName, email: v.hiringManagerEmail, jobTitle: v.hiringManagerJobTitle } : null}
              onChange={saveHiringManager} />
            <Alert type="error" message={hmError} />
          </Panel>
          <HeadcountPanel vacancy={v} />
        </div>
      </div>
    ),
    applicants: () => (
      <ApplicantsTable vacancy={v} applications={apps} staffRole={staff?.role} onOpen={(a) => setOpenAppId(a.id)} onUpdated={() => changed()} />
    ),
    committee: () => (unpublished ? <div className="ws-panel ws-empty">The committee rates applicants once the vacancy has been advertised and applications have closed.</div> : (
      <>
        {canBeginReview && (
          <Card accent="var(--color-warning)">
            <strong>{apps.filter((a) => a.status === 'Submitted').length}</strong> application(s) not yet screened.
            <Button style={{ marginLeft: 12 }} onClick={beginReview} loading={beginning} loadingText="Screening...">Begin review</Button>
          </Card>
        )}
        {v.reviewStartedAt && (
          <ShortlistCommittee vacancy={v} staffRole={staff?.role} reloadKey={reloadKey} onChanged={() => changed()} onManagedChange={setCommitteeManaged} />
        )}
        <Panel title="Interview shortlist" note="Who is interviewed, in what order. A Principal HR Officer approves it, then EXCO." padded>
          <ShortlistPipelineBoard vacancy={v} applications={apps} staffRole={staff?.role} onUpdated={() => changed()}
            onDownloadCv={downloadCv} downloadingId={downloadingId} onGoToStage={(s) => setTab(s === 'shortlist' ? 'committee' : s)} committeeManaged={committeeManaged} />
        </Panel>
      </>
    )),
    interviews: () => (unpublished ? <div className="ws-panel ws-empty">Interviews are booked after EXCO approves the interview shortlist.</div> : (
      <VacancyInterviewsPanel vacancy={v} applications={apps} staffRole={staff?.role} onUpdated={() => changed()} onGoToMeritList={() => setTab('merit')} />
    )),
    merit: () => (unpublished ? <div className="ws-panel ws-empty">The merit list is drawn up once interview results are recorded.</div> : (
      <MeritListBoard vacancy={v} staffRole={staff?.role} reloadKey={reloadKey} onChanged={() => changed()} />
    )),
    history: () => <Panel><AuditTrail entityType="Vacancy" entityId={v.id} label="Vacancy history" defaultOpen /></Panel>
  }[tab];

  return (
    <div style={{ display: 'flex', gap: 'var(--spacing-lg)', alignItems: 'flex-start' }}>
      <HRSidebar active="vacancies" />
      <div className="ws-page" style={{ flex: 1 }}>
        {!v ? (
          <>
            <Skeleton width={220} height={13} />
            <Skeleton width={320} height={26} />
            <Skeleton height={64} />
            <Skeleton height={44} />
          </>
        ) : (
          <>
            <PageTop
              crumb={[{ label: 'Vacancies', to: '/hr' }, { label: v.jobRef, mono: true }]}
              title={v.title}
              subtitle={<Meta parts={[
                progress && <Pill tone={progress.stage.tone}>{progress.stage.label}</Pill>,
                v.readvertisedFromId != null && <Pill tone="info">Readvertised</Pill>,
                `${v.department?.name || ''}${v.department?.directorate?.name ? `, ${v.department.directorate.name}` : ''}`,
                v.postingType,
                `${v.positionsRequired} post${v.positionsRequired === 1 ? '' : 's'}`,
                v.deadline && `${deadlinePassed ? 'Applications closed' : 'Closes'} ${formatDay(v.deadline)}`
              ]} />}
              actions={<VacancyActions vacancy={v} staffRole={staff?.role} onChanged={changed} primary={primary} />}
            />
            <Alert type="success" message={message} />
            <Alert type="error" message={error} />
            {v.status === 'Returned' && v.returnReason && <Alert type="warning" message={`Returned for changes: ${v.returnReason}`} />}
            {v.status === 'Rejected' && <Alert type="error" message={`Rejected: ${v.rejectionReason || 'no reason recorded'}`} />}
            {v.status === 'Closed' && v.closeReason && <Alert type="info" message={`Closed: ${v.closeReason}`} />}

            {next && (
              <div className="ws-next">
                <div>
                  <div className="label">{next.role ? `Next step · ${next.who}` : 'Where it stands'}</div>
                  <p>{next.text}</p>
                </div>
                {!primary && next.role && <span className="ws-note">Waiting on the {next.who}</span>}
              </div>
            )}

            {progress?.stepIndex != null || v.status === 'Filled' ? (
              <div className="ws-steps" role="list">
                {(progress?.steps || []).map((s, i) => (
                  <button key={s.key} type="button" role="listitem" className={`ws-step ${s.state === 'done' ? 'done' : s.state === 'now' ? 'now' : ''}`}
                    onClick={() => setTab(s.tab)} aria-current={s.state === 'now' ? 'step' : undefined}>
                    <span className="ic">{s.state === 'done' ? '✓' : i + 1}</span>
                    {s.label}{s.detail && <small> {s.detail}</small>}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="ws-tabs" role="tablist">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={`ws-tab${tab === key ? ' on' : ''}`} onClick={() => setTab(key)}>
                  {label}{key === 'applicants' && <span className="n">{apps.length}</span>}
                </button>
              ))}
            </div>

            {body()}
          </>
        )}
        {hiddenPrintArea}
      </div>

      {openApp && v && (
        <SidePanel wide title={openApp.candidate.fullName} eyebrow={<>{v.title} · <span className="ws-mono">{v.jobRef}</span></>}
          onClose={() => setOpenAppId(null)}>
          <ApplicationReviewCard app={openApp} vacancy={v} staffRole={staff?.role} onUpdated={() => changed()}
            onDownloadCv={downloadCv} downloadingId={downloadingId} defaultExpanded />
        </SidePanel>
      )}
    </div>
  );
}
