import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import StatusBadge from './StatusBadge';
import Modal from './Modal';
import TextArea from './TextArea';
import { fileLink } from '../utils/fileLink';
import { safeJsonParse } from '../utils/safeJsonParse';
import InterviewScheduler from './interviews/InterviewScheduler';
import InterviewRoundPanel from './interviews/InterviewRoundPanel';
import { ROUND_LABELS } from './interviews/formStyles';
import { formatDateTime, venueLabel } from '../utils/interviews';

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK - used so
// "Recommend for offer" (Principal HR Officer+), "Approve offer"
// (Manager+), and "Reject"/"Mark verified" (Senior HR Officer+) are gated
// by rank rather than an exact-role string match.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

// A status HR can reach from anywhere before an offer is on the table -
// Submitted through Interviewed. Not Draft (the candidate's own to
// withdraw, HR never sees it), not Offered/Rejected/Withdrawn (already
// terminal or past the point rejection makes sense here).
const NOT_REJECTABLE = ['Draft', 'Offered', 'Rejected', 'Withdrawn'];

// One application's full review card - screening detail, verification,
// interviews (a summary of each round, opening the shared round workspace -
// scheduling, panel, scores and finalizing live there and in the Interview
// Hub), offer actions, and reject.
// Extracted out of VacancyDetail.jsx so both the cross-vacancy "All
// vacancies" queue and the single-vacancy view in ApplicationManagement.jsx
// can render the exact same review experience HR already had.
//
// vacancy needs at least preferredFieldOfStudy (for the field-of-study
// flag's label) - the cross-vacancy queue passes app.vacancy, the
// single-vacancy view passes its one already-fetched vacancy.
// showVacancyContext additionally renders which vacancy this application
// belongs to, which only makes sense when applications from several
// vacancies are mixed together in one list (the cross-vacancy queue).
export default function ApplicationReviewCard({
  app, vacancy, staffRole, onUpdated, onDownloadCv, downloadingId, showVacancyContext = false,
  defaultExpanded = true
}) {
  const rank = ROLE_RANK[staffRole] || 0;
  // The cross-vacancy queue (ApplicationManagement.jsx's "All vacancies"
  // mode) passes defaultExpanded={false} - up to 20 of these render at once
  // there, each with essential/desirable/eligibility criteria and interview
  // rounds, so collapsed-by-default keeps the list scannable. The
  // single-vacancy "All applications" list keeps the old always-expanded
  // behavior, since comparing candidates side-by-side there benefits from
  // full detail up front.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [error, setError] = useState('');
  // One flag for every mutating action on this card - a slow network plus
  // an impatient double-click would otherwise fire the same request twice
  // (double-reject, double-approve-offer, etc.), since none of these are
  // naturally idempotent from the UI's point of view.
  const [submitting, setSubmitting] = useState(false);

  // Only one modal is ever open for this card at a time, so a single
  // discriminated slot is enough instead of five separate booleans.
  const [activeModal, setActiveModal] = useState(null); // 'verify' | 'reject' | 'withdrawOffer' | null
  // The scheduler and the round workspace are their own modals (shared with
  // the Interview Hub), so they sit outside activeModal.
  const [scheduling, setScheduling] = useState(false);
  const [openRoundId, setOpenRoundId] = useState(null);

  const [verifyDecision, setVerifyDecision] = useState('HR_Verified');
  const [verifyComments, setVerifyComments] = useState('');
  const [verifyFile, setVerifyFile] = useState(null);

  const [rejectReason, setRejectReason] = useState('');

  const closeModal = () => setActiveModal(null);

  const openVerify = (decision) => {
    setVerifyDecision(decision); setVerifyComments(''); setVerifyFile(null); setError('');
    setActiveModal('verify');
  };
  const submitVerify = async () => {
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('decision', verifyDecision);
      if (verifyComments) formData.append('comments', verifyComments);
      if (verifyFile) formData.append('recommendationLetter', verifyFile);
      await staffClient.patch(`/api/verification/candidates/${app.candidate.id}/verify`, formData,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  };

  const openReject = () => { setRejectReason(''); setError(''); setActiveModal('reject'); };
  const submitReject = async () => {
    setSubmitting(true);
    try {
      await staffClient.patch(`/api/applications/${app.id}/reject`, { reason: rejectReason || undefined });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reject this application');
    } finally {
      setSubmitting(false);
    }
  };

  // Principal_HR_Officer+ can take back an offer that is still in play -
  // typically one that can no longer be accepted because the vacancy filled.
  const [withdrawReason, setWithdrawReason] = useState('');
  const openWithdrawOffer = () => { setWithdrawReason(''); setError(''); setActiveModal('withdrawOffer'); };
  const submitWithdrawOffer = async () => {
    setSubmitting(true);
    try {
      await staffClient.patch(`/api/applications/offers/${app.offer.id}/withdraw`, { reason: withdrawReason || undefined });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not withdraw this offer');
    } finally {
      setSubmitting(false);
    }
  };

  const approveOffer = async () => {
    setSubmitting(true);
    try {
      await staffClient.patch(`/api/applications/offers/${app.offer.id}/approve`);
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not approve offer');
    } finally {
      setSubmitting(false);
    }
  };
  const recommendOffer = async () => {
    setError(''); setSubmitting(true);
    try {
      await staffClient.post(`/api/applications/${app.id}/recommend-offer`);
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not recommend offer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}

      {showVacancyContext && app.vacancy && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          {app.vacancy.jobRef} &middot; {app.vacancy.title}
          {app.vacancy.department?.name && <> &middot; {app.vacancy.department.name}{app.vacancy.department.directorate?.name ? `, ${app.vacancy.department.directorate.name}` : ''}</>}
        </div>
      )}

      {/* Header doubles as the collapse toggle - the only thing always
          visible per card in a long queue, so it carries every scan-worthy
          signal (status, rank, score, screening) up front rather than
          making HR expand each one just to triage. */}
      <div onClick={() => setExpanded((v) => !v)} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
        <div>
          <strong>{app.candidate.fullName}</strong> ({app.candidate.candidateType}) &mdash; <StatusBadge status={app.status} />
          {app.rank && <span> &middot; Rank {app.rank} ({app.listStatus})</span>}
          {app.shortlistScore != null && (
            <span style={{ color: 'var(--color-text-muted)', marginLeft: 8, fontSize: 13 }}>&middot; Score {app.shortlistScore.toFixed(1)}</span>
          )}
          {app.screeningPassed === false && (
            <span title={safeJsonParse(app.screeningReasons, []).join('; ')}
              style={{ color: 'var(--color-warning)', marginLeft: 8, fontSize: 13 }}>
              &#9888; {safeJsonParse(app.screeningReasons, []).length} flag(s)
            </span>
          )}
          {app.screeningPassed === true && (
            <span style={{ color: 'var(--color-success)', marginLeft: 8, fontSize: 13 }}>&#10003; Meets criteria</span>
          )}
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span>
          CV:{' '}
          <button type="button" onClick={() => onDownloadCv(app, vacancy)} disabled={downloadingId === app.id}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-primary)', cursor: downloadingId === app.id ? 'default' : 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}>
            {downloadingId === app.id ? 'Generating...' : 'Download generated CV'}
          </button>
        </span>
        <span>
          Cover letter: {app.coverLetterUrl ? <a href={fileLink(app.coverLetterUrl)} target="_blank" rel="noreferrer">view</a> : 'none'}
        </span>
      </div>

      {app.status === 'Rejected' && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', margin: '6px 0' }}>
          Rejected{app.rejectedBy?.name ? ` by ${app.rejectedBy.name}` : ''}{app.rejectedAt ? ` on ${new Date(app.rejectedAt).toLocaleDateString()}` : ''}
          {app.rejectionReason ? `: "${app.rejectionReason}"` : ''}
        </div>
      )}

      {expanded && (
        <>
          {/* Minimum required specifications (Essential Requirements) -
              the mandatory counterpart to the Desirable Requirements list
              below: every minimum the vacancy actually sets is itemized
              with its own met/not-met status and the specific reason,
              instead of only the collapsed flag-count/"Meets criteria"
              badge above. */}
          {safeJsonParse(app.essentialCriteriaResults, []).length > 0 && (
            <div style={{ fontSize: 13, margin: '6px 0' }}>
              <strong>Minimum required specifications:</strong>{' '}
              {safeJsonParse(app.essentialCriteriaResults, []).filter((r) => r.met).length} of {safeJsonParse(app.essentialCriteriaResults, []).length} met
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'none' }}>
                {safeJsonParse(app.essentialCriteriaResults, []).map((r) => (
                  <li key={r.key} style={{ color: r.met ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {r.met ? '✓' : '✗'} {r.label} (requires {r.requirement}) &mdash; {r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Eligibility questions (disqualifying) - unlike Desirable
              Requirements below, a "wrong" answer here DOES fail
              screeningPassed (see screeningService.screenApplication), so
              this is styled as a real gate (danger, not warning) rather
              than a soft flag. met/not-met is derived here from the
              snapshotted answer vs. requiredAnswer, same values
              screenApplication itself compared at screening time. */}
          {app.disqualifyingResponses?.length > 0 && (() => {
            // A 'number' row (see ScreeningQuestionsEditor.jsx) is met once
            // the answer reaches its own snapshotted minValue - same
            // comparison screenApplication itself used at screening time.
            // Every other row (including one with no answerType, from
            // before 'number' existed) keeps the original Yes/No compare.
            const isMet = (r) => r.answerType === 'number'
              ? typeof r.answer === 'number' && r.answer >= r.minValue
              : r.answer === (r.requiredAnswer !== 'No');
            return (
              <div style={{ fontSize: 13, margin: '6px 0' }}>
                <strong>Eligibility questions:</strong>{' '}
                {app.disqualifyingResponses.filter(isMet).length} of {app.disqualifyingResponses.length} met
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'none' }}>
                  {app.disqualifyingResponses.map((r) => {
                    const met = isMet(r);
                    return (
                      <li key={r.id} style={{ color: met ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {met ? '✓' : '✗'} {r.text} {r.answerType === 'number'
                          ? `(must be at least ${r.minValue}, answered ${r.answer ?? '—'})`
                          : `(must answer ${r.requiredAnswer}, answered ${r.answer ? 'Yes' : 'No'})`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}

          {/* Shortlist score - a ranking signal, not a gate (see
              scoreApplication's comment): additive credit for exceeding a
              minimum or matching a preference, shown with the specific
              reasons behind it rather than a bare number, so HR can see
              exactly what earned it. The score itself is already in the
              header above - this is just the reasons behind it. */}
          {app.shortlistScore != null && (
            <div style={{ fontSize: 13, margin: '6px 0' }}>
              {safeJsonParse(app.shortlistScoreReasons, []).length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-text-muted)' }}>
                  {safeJsonParse(app.shortlistScoreReasons, []).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>No factors above the vacancy's stated minimums/preferences</span>
              )}
            </div>
          )}

          {/* Field-of-study is a preference, not a requirement (free text,
              no controlled vocabulary) - kept out of screeningPassed, shown
              as its own worth-a-glance flag instead. */}
          {app.fieldOfStudyMatch === false && (
            <div style={{ fontSize: 13, color: 'var(--color-warning)', margin: '6px 0' }}>
              &#9888; Field of study may not match the preferred field ({vacancy?.preferredFieldOfStudy}) - worth a second look, not part of screening
            </div>
          )}

          {/* Desirable Requirements - preferred, not mandatory, criteria:
              informational only, never part of screeningPassed (a "No"
              here doesn't fail screening). Every requirement is listed
              individually with its own answer rather than collapsing a
              clean sweep into one generic line, so HR can see exactly
              which preferences a candidate does and doesn't meet. Each
              "Yes" here is also what scoreApplication credits in the
              shortlist score above. */}
          {app.desirableResponses?.length > 0 && (() => {
            const isMet = (r) => r.answerType === 'number'
              ? typeof r.answer === 'number' && r.answer >= r.minValue
              : r.answer === true;
            return (
              <div style={{ fontSize: 13, margin: '6px 0' }}>
                <strong>Desirable (preferred) requirements:</strong>{' '}
                {app.desirableResponses.filter(isMet).length} of {app.desirableResponses.length} met
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'none' }}>
                  {app.desirableResponses.map((r) => {
                    const met = isMet(r);
                    return (
                      <li key={r.id} style={{ color: met ? 'var(--color-success)' : 'var(--color-warning)' }}>
                        {met ? '✓' : '⚠'} {r.text}{r.answerType === 'number' ? ` (answered ${r.answer ?? '—'}, needs ${r.minValue})` : ''}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}

          {app.candidate.candidateType === 'Internal' && app.candidate.internalProfile && (
            <Card accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)', marginBottom: 8 }}>
              <strong>Internal verification:</strong> <StatusBadge status={app.candidate.internalProfile.verificationStatus} />
              {app.candidate.internalProfile.verificationStatus !== 'HR_Verified' && (
                <div style={{ marginTop: 8 }}>
                  <Button variant="secondary" onClick={() => openVerify('HR_Verified')}>Mark HR Verified</Button>{' '}
                  <Button variant="ghost" onClick={() => openVerify('Discrepancy_Flagged')}>Flag discrepancy</Button>
                </div>
              )}
            </Card>
          )}

          {app.interviewRounds.map((r) => {
            const active = (r.panelMembers || []).filter((p) => !p.recusedAt);
            const scored = active.filter((p) => p.score != null).length;
            return (
              <Card key={r.id} accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <strong>Round {r.roundNumber}</strong>
                  {' · '}{formatDateTime(r.scheduledDate)}
                  {' · '}{venueLabel(r)}
                  <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Panel {scored}/{active.length} scored
                    {r.score != null && <> &middot; average {r.score.toFixed(1)}</>}
                    {r.status === 'Scheduled' && r.candidateResponse && <> &middot; candidate: {ROUND_LABELS[r.candidateResponse]}</>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <StatusBadge status={r.status || 'Scheduled'} label={ROUND_LABELS[r.status]} />
                  {r.recommendation && <StatusBadge status={r.recommendation} />}
                  <Button variant="ghost" style={{ padding: '4px 10px' }} onClick={() => setOpenRoundId(r.id)}>Open</Button>
                </div>
              </Card>
            );
          })}
        </>
      )}

      <div style={{ marginTop: 8 }}>
        {['Shortlisted', 'InterviewScheduled', 'Interviewed'].includes(app.status) && !app.offer && (
          <Button variant="secondary" onClick={() => setScheduling(true)}>
            {app.interviewRounds.length === 0 ? 'Schedule interview' : 'Schedule another round'}
          </Button>
        )}
        {app.status === 'Interviewed' && !app.offer && rank >= ROLE_RANK.Principal_HR_Officer && (
          <Button style={{ marginLeft: 8 }} onClick={recommendOffer} disabled={submitting}>Recommend for offer</Button>
        )}
        {app.offer && rank >= ROLE_RANK.Manager && app.offer.status === 'Recommended' && (
          <Button onClick={approveOffer} disabled={submitting}>Approve offer</Button>
        )}
        {app.offer && <span style={{ marginLeft: 8 }}>Offer: <StatusBadge status={app.offer.status} /></span>}
        {app.offer && ['Recommended', 'Approved'].includes(app.offer.status) && rank >= ROLE_RANK.Principal_HR_Officer && (
          <Button
            variant="ghost"
            style={{ marginLeft: 8, color: 'var(--color-danger)' }}
            onClick={openWithdrawOffer}
          >
            Withdraw offer
          </Button>
        )}
        {!NOT_REJECTABLE.includes(app.status) && rank >= ROLE_RANK.Senior_HR_Officer && (
          <Button
            variant="ghost"
            style={{ marginLeft: 8, color: 'var(--color-danger)' }}
            onClick={openReject}
          >
            Reject
          </Button>
        )}
      </div>

      {activeModal === 'reject' && (
        <Modal
          title={`Reject application — ${app.candidate.fullName}`}
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitReject} disabled={submitting}>{submitting ? 'Rejecting...' : 'Confirm rejection'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            This is a final decision - the candidate will be notified by email and in-app. A reason is optional
            but is included in their notification when given.
          </p>
          <TextArea label="Reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Modal>
      )}

      {activeModal === 'withdrawOffer' && (
        <Modal
          title={`Withdraw offer — ${app.candidate.fullName}`}
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitWithdrawOffer} disabled={submitting}>{submitting ? 'Withdrawing...' : 'Confirm withdrawal'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            The offer can no longer be accepted once withdrawn, and this cannot be undone.
            {app.offer?.status === 'Approved'
              ? ' The candidate has already been told about this offer, so they will be notified by email and in-app. A reason is optional but is included in their notification when given.'
              : ' The offer has not been approved yet, so the candidate was never told about it and will not be notified.'}
          </p>
          <TextArea label="Reason (optional)" value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} />
        </Modal>
      )}

      {activeModal === 'verify' && (
        <Modal
          title={verifyDecision === 'HR_Verified' ? 'Verify employment' : 'Flag discrepancy'}
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitVerify} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Provide comments (min. 20 characters) or attach a manager recommendation letter as evidence.
          </p>
          <TextArea label="Comments" value={verifyComments} onChange={(e) => setVerifyComments(e.target.value)} />
          <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Manager recommendation letter (optional if comments provided)
          </label>
          <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setVerifyFile(e.target.files[0])} />
        </Modal>
      )}

      {scheduling && (
        <InterviewScheduler
          presetVacancyId={app.vacancyId || vacancy?.id}
          presetApplicationIds={[app.id]}
          onClose={() => setScheduling(false)}
          onScheduled={onUpdated}
        />
      )}
      {openRoundId && (
        <InterviewRoundPanel roundId={openRoundId} onClose={() => setOpenRoundId(null)} onChanged={onUpdated} />
      )}
    </Card>
  );
}
