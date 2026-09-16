import React, { useState } from 'react';
import staffClient from '../models/staffApiClient';
import Card from './Card';
import Button from './Button';
import StatusBadge from './StatusBadge';
import Modal from './Modal';
import TextField from './TextField';
import TextArea from './TextArea';
import Select from './Select';
import { fileLink } from '../utils/fileLink';
import { safeJsonParse } from '../utils/safeJsonParse';

const emptyPanelist = { name: '', trade: '', email: '' };

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
// interview scheduling/scoring/finalizing, offer actions, and reject.
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
  app, vacancy, staffRole, onUpdated, onDownloadCv, downloadingId, showVacancyContext = false
}) {
  const rank = ROLE_RANK[staffRole] || 0;
  const [error, setError] = useState('');
  const [linkMessage, setLinkMessage] = useState('');
  // One flag for every mutating action on this card - a slow network plus
  // an impatient double-click would otherwise fire the same request twice
  // (double-reject, double-approve-offer, etc.), since none of these are
  // naturally idempotent from the UI's point of view.
  const [submitting, setSubmitting] = useState(false);
  // sendAccessLink is keyed separately (by panel member id) rather than
  // reusing `submitting` - multiple panelists' links are independent
  // actions, and per its own success message ("any previous link ... now
  // invalid"), a double-click here can invalidate a link just shown to HR
  // before they can copy it, so this one specifically needs its own guard.
  const [linkSubmittingId, setLinkSubmittingId] = useState(null);

  // Only one modal is ever open for this card at a time, so a single
  // discriminated slot is enough instead of five separate booleans.
  const [activeModal, setActiveModal] = useState(null); // 'verify' | 'reject' | 'interview' | 'score' | 'finalize' | null

  const [verifyDecision, setVerifyDecision] = useState('HR_Verified');
  const [verifyComments, setVerifyComments] = useState('');
  const [verifyFile, setVerifyFile] = useState(null);

  const [rejectReason, setRejectReason] = useState('');

  const [interviewDate, setInterviewDate] = useState('');
  const [interviewMode, setInterviewMode] = useState('In-person');
  const [panelists, setPanelists] = useState([{ ...emptyPanelist }]);

  const [scoreTarget, setScoreTarget] = useState(null); // { panelMemberId, name }
  const [scoreValue, setScoreValue] = useState('');
  const [scoreComments, setScoreComments] = useState('');

  const [finalizeTarget, setFinalizeTarget] = useState(null); // { interviewId }
  const [recommendation, setRecommendation] = useState('Shortlist');

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

  const openSchedule = () => {
    setInterviewDate(''); setInterviewMode('In-person'); setPanelists([{ ...emptyPanelist }]); setError('');
    setActiveModal('interview');
  };
  const updatePanelist = (index, field, value) => {
    setPanelists((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };
  const addPanelistRow = () => setPanelists((prev) => [...prev, { ...emptyPanelist }]);
  const removePanelistRow = (index) => setPanelists((prev) => prev.filter((_, i) => i !== index));
  const submitSchedule = async () => {
    if (!interviewDate) { setError('Please choose an interview date'); return; }
    const validPanelists = panelists.filter((p) => p.name.trim());
    setSubmitting(true);
    try {
      await staffClient.post(`/api/interviews/applications/${app.id}/interviews`, {
        scheduledDate: interviewDate, mode: interviewMode, panelMembers: validPanelists
      });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not schedule interview');
    } finally {
      setSubmitting(false);
    }
  };

  const openScore = (panelMemberId, name) => {
    setScoreTarget({ panelMemberId, name }); setScoreValue(''); setScoreComments(''); setError('');
    setActiveModal('score');
  };
  const submitScore = async () => {
    // Number('') is 0, not "empty" - without this check a blank field
    // silently submits as a deliberate zero score instead of being caught.
    const numericScore = Number(scoreValue);
    if (scoreValue === '' || !Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
      setError('Enter a score between 0 and 100');
      return;
    }
    setSubmitting(true);
    try {
      await staffClient.patch(`/api/interviews/panel-members/${scoreTarget.panelMemberId}/score`, {
        score: numericScore, comments: scoreComments
      });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save score');
    } finally {
      setSubmitting(false);
    }
  };

  const sendAccessLink = async (panelMemberId, name) => {
    setError(''); setLinkMessage(''); setLinkSubmittingId(panelMemberId);
    try {
      const res = await staffClient.post(`/api/interviews/panel-members/${panelMemberId}/access-link`);
      setLinkMessage(
        res.data.emailed
          ? `Scoring link (re)sent to ${name}. Any previous link for them is now invalid.`
          : `${name} has no email on file. Share this link directly - it replaces any previous link: ${res.data.url}`
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate scoring link');
    } finally {
      setLinkSubmittingId(null);
    }
  };

  const openFinalize = (interviewId) => {
    setFinalizeTarget({ interviewId }); setRecommendation('Shortlist'); setError('');
    setActiveModal('finalize');
  };
  const submitFinalize = async () => {
    setSubmitting(true);
    try {
      await staffClient.patch(`/api/interviews/${finalizeTarget.interviewId}/finalize`, { recommendation });
      closeModal();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not finalize recommendation');
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
      {linkMessage && <div style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 8 }}>{linkMessage}</div>}

      {showVacancyContext && app.vacancy && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
          {app.vacancy.jobRef} &middot; {app.vacancy.title}
          {app.vacancy.department?.name && <> &middot; {app.vacancy.department.name}{app.vacancy.department.directorate?.name ? `, ${app.vacancy.department.directorate.name}` : ''}</>}
        </div>
      )}

      <strong>{app.candidate.fullName}</strong> ({app.candidate.candidateType}) &mdash; <StatusBadge status={app.status} />
      {app.rank && <span> &middot; Rank {app.rank} ({app.listStatus})</span>}
      {app.screeningPassed === false && (
        <span title={safeJsonParse(app.screeningReasons, []).join('; ')}
          style={{ color: 'var(--color-warning)', marginLeft: 8, fontSize: 13 }}>
          &#9888; {safeJsonParse(app.screeningReasons, []).length} flag(s)
        </span>
      )}
      {app.screeningPassed === true && (
        <span style={{ color: 'var(--color-success)', marginLeft: 8, fontSize: 13 }}>&#10003; Meets criteria</span>
      )}
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
          exactly what earned it. */}
      {app.shortlistScore != null && (
        <div style={{ fontSize: 13, margin: '6px 0' }}>
          <strong>Score: {app.shortlistScore.toFixed(1)}</strong>
          {safeJsonParse(app.shortlistScoreReasons, []).length > 0 ? (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--color-text-muted)' }}>
              {safeJsonParse(app.shortlistScoreReasons, []).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}> &mdash; no factors above the vacancy's stated minimums/preferences</span>
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

      {app.status === 'Rejected' && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', margin: '6px 0' }}>
          Rejected{app.rejectedBy?.name ? ` by ${app.rejectedBy.name}` : ''}{app.rejectedAt ? ` on ${new Date(app.rejectedAt).toLocaleDateString()}` : ''}
          {app.rejectionReason ? `: "${app.rejectionReason}"` : ''}
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

      {app.interviewRounds.map((r) => (
        <Card key={r.id} accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)' }}>
          <strong>Round {r.roundNumber}</strong>
          {' · '}{r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : 'unscheduled'}
          {' · '}{r.mode}
          {r.score != null && <span> &middot; Panel average: {r.score.toFixed(1)}</span>}
          {r.recommendation && <span> &middot; Recommendation: <StatusBadge status={r.recommendation} /></span>}

          <div style={{ marginTop: 8 }}>
            {(r.panelMembers || []).map((p) => (
              <div key={p.id} style={{ fontSize: 13, marginBottom: 4 }}>
                {p.name}{p.trade ? ` (${p.trade})` : ''}
                {p.score != null ? (
                  <span>
                    {' '}&mdash; scored {p.score}{p.comments ? `: "${p.comments}"` : ''}
                    {' '}<span style={{ color: 'var(--color-text-muted)' }}>
                      ({p.selfSubmitted ? 'submitted by panelist' : 'recorded by HR'})
                    </span>
                  </span>
                ) : (
                  <>
                    <Button variant="ghost" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => openScore(p.id, p.name)}>
                      Record score
                    </Button>
                    <Button variant="ghost" style={{ marginLeft: 4, padding: '2px 8px' }}
                      onClick={() => sendAccessLink(p.id, p.name)} disabled={linkSubmittingId === p.id}>
                      {linkSubmittingId === p.id ? 'Sending...' : 'Send/regenerate scoring link'}
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>

          {!r.recommendation && (
            <Button
              variant="secondary"
              style={{ marginTop: 8 }}
              disabled={r.score == null}
              onClick={() => openFinalize(r.id)}
            >
              Finalize recommendation
            </Button>
          )}
        </Card>
      ))}

      <div style={{ marginTop: 8 }}>
        {['Shortlisted', 'InterviewScheduled', 'Interviewed'].includes(app.status) && !app.offer && (
          <Button variant="secondary" onClick={openSchedule}>
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

      {activeModal === 'interview' && (
        <Modal
          title="Schedule interview"
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitSchedule} disabled={submitting}>{submitting ? 'Scheduling...' : 'Schedule'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <TextField label="Interview date" type="date" value={interviewDate}
            onChange={(e) => setInterviewDate(e.target.value)} />
          <Select label="Mode" value={interviewMode} onChange={(e) => setInterviewMode(e.target.value)}>
            <option value="In-person">In-person</option>
            <option value="Virtual">Virtual</option>
          </Select>

          <div style={{ marginTop: 'var(--spacing-sm)' }}>
            <span style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Panel members - no system account needed for any of them
            </span>
            {panelists.map((p, index) => (
              <div key={index} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <input placeholder="Name" value={p.name} onChange={(e) => updatePanelist(index, 'name', e.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
                <input placeholder="Trade / position" value={p.trade} onChange={(e) => updatePanelist(index, 'trade', e.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
                <input placeholder="Email (optional)" value={p.email} onChange={(e) => updatePanelist(index, 'email', e.target.value)}
                  style={{ flex: 2, padding: 6, border: '1px solid var(--color-border)', borderRadius: 'var(--radius)' }} />
                {panelists.length > 1 && (
                  <button type="button" onClick={() => removePanelistRow(index)}
                    style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}>&times;</button>
                )}
              </div>
            ))}
            <Button variant="ghost" style={{ padding: '4px 10px', fontSize: 13 }} onClick={addPanelistRow}>+ Add panelist</Button>
          </div>
        </Modal>
      )}

      {activeModal === 'score' && (
        <Modal
          title={`Record score — ${scoreTarget?.name}`}
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitScore} disabled={submitting}>{submitting ? 'Saving...' : 'Save score'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Entered on this panelist's behalf - no login required for them.
          </p>
          <TextField label="Score (0-100)" type="number" min="0" max="100" value={scoreValue}
            onChange={(e) => setScoreValue(e.target.value)} />
          <TextArea label="Comments" value={scoreComments} onChange={(e) => setScoreComments(e.target.value)} />
        </Modal>
      )}

      {activeModal === 'finalize' && (
        <Modal
          title="Finalize recommendation"
          onClose={closeModal}
          footer={<>
            <Button variant="ghost" onClick={closeModal} disabled={submitting}>Cancel</Button>
            <Button onClick={submitFinalize} disabled={submitting}>{submitting ? 'Finalizing...' : 'Finalize'}</Button>
          </>}
        >
          {error && <div style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            This is your judgment call informed by the panel's scores, not an automatic average.
          </p>
          <Select label="Recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value)}>
            <option value="Shortlist">Shortlist</option>
            <option value="Hold">Hold</option>
            <option value="Reject">Reject</option>
          </Select>
        </Modal>
      )}
    </Card>
  );
}
