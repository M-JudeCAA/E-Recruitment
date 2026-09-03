import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import staffClient from '../models/staffApiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import Button from '../components/Button';
import Alert from '../components/Alert';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';
import TextField from '../components/TextField';
import TextArea from '../components/TextArea';
import Select from '../components/Select';

const emptyPanelist = { name: '', trade: '', email: '' };

// Matches backend/src/middleware/auth.js's 5-tier ROLE_RANK - used here so
// "Recommend for offer" (Principal HR Officer+) and "Approve offer"
// (Manager+) are gated by rank rather than an exact-role string match,
// which would otherwise wrongly exclude Manager/Director from both and
// Senior HR Officer would wrongly qualify for the former.
const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };

export default function VacancyDetail() {
  const { id } = useParams();
  const { staff } = useAuth();
  const [vacancy, setVacancy] = useState(null);
  const [applications, setApplications] = useState([]);
  const [shortlistOrder, setShortlistOrder] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [error, setError] = useState('');

  // Interview scheduling modal - panelists are captured as a repeatable list,
  // no accounts required for any of them.
  const [interviewModal, setInterviewModal] = useState(null); // { applicationId }
  const [interviewDate, setInterviewDate] = useState('');
  const [interviewMode, setInterviewMode] = useState('In-person');
  const [panelists, setPanelists] = useState([{ ...emptyPanelist }]);

  // Proxy score-entry modal - the coordinating HR Officer enters a score
  // on behalf of a named panelist who may have no system account.
  const [scoreModal, setScoreModal] = useState(null); // { panelMemberId, name }
  const [scoreValue, setScoreValue] = useState('');
  const [scoreComments, setScoreComments] = useState('');
  const [linkMessage, setLinkMessage] = useState('');

  // Finalize recommendation modal - a deliberate HR judgment call, separate
  // from the averaged panel score.
  const [finalizeModal, setFinalizeModal] = useState(null); // { interviewId }
  const [recommendation, setRecommendation] = useState('Shortlist');

  const [verifyModal, setVerifyModal] = useState(null); // { candidateId, decision }
  const [verifyComments, setVerifyComments] = useState('');
  const [verifyFile, setVerifyFile] = useState(null);

  const load = () => {
    staffClient.get(`/api/vacancies/${id}`).then((res) => setVacancy(res.data));
    staffClient.get(`/api/vacancies/${id}/applications`).then((res) => {
      setApplications(res.data);
      const alreadyRanked = res.data
        .filter((a) => a.rank != null)
        .sort((a, b) => a.rank - b.rank)
        .map((a) => a.id);
      const candidates = res.data
        .filter((a) => a.status === 'UnderReview' && a.rank == null)
        .map((a) => a.id);
      setShortlistOrder([...alreadyRanked, ...candidates]);
    });
  };
  useEffect(() => { load(); }, [id]);

  const moveInOrder = (fromIndex, toIndex) => {
    setShortlistOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const saveRanking = async () => {
    setError('');
    try {
      await staffClient.post(`/api/vacancies/${id}/rank`, { applicationIds: shortlistOrder });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save ranking');
    }
  };

  // --- Verification modal ---
  const openVerify = (candidateId, decision) => {
    setVerifyComments(''); setVerifyFile(null); setError('');
    setVerifyModal({ candidateId, decision });
  };
  const submitVerify = async () => {
    try {
      const formData = new FormData();
      formData.append('decision', verifyModal.decision);
      if (verifyComments) formData.append('comments', verifyComments);
      if (verifyFile) formData.append('recommendationLetter', verifyFile);
      await staffClient.patch(`/api/verification/candidates/${verifyModal.candidateId}/verify`, formData,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setVerifyModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed');
    }
  };

  // --- Interview scheduling modal ---
  const openSchedule = (applicationId) => {
    setInterviewDate(''); setInterviewMode('In-person'); setPanelists([{ ...emptyPanelist }]); setError('');
    setInterviewModal({ applicationId });
  };
  const updatePanelist = (index, field, value) => {
    setPanelists((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  };
  const addPanelistRow = () => setPanelists((prev) => [...prev, { ...emptyPanelist }]);
  const removePanelistRow = (index) => setPanelists((prev) => prev.filter((_, i) => i !== index));

  const submitSchedule = async () => {
    if (!interviewDate) { setError('Please choose an interview date'); return; }
    const validPanelists = panelists.filter((p) => p.name.trim());
    try {
      await staffClient.post(`/api/interviews/applications/${interviewModal.applicationId}/interviews`, {
        scheduledDate: interviewDate, mode: interviewMode, panelMembers: validPanelists
      });
      setInterviewModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not schedule interview');
    }
  };

  // --- Proxy panel score entry ---
  const openScore = (panelMemberId, name) => {
    setScoreValue(''); setScoreComments(''); setError('');
    setScoreModal({ panelMemberId, name });
  };
  const submitScore = async () => {
    try {
      await staffClient.patch(`/api/interviews/panel-members/${scoreModal.panelMemberId}/score`, {
        score: Number(scoreValue), comments: scoreComments
      });
      setScoreModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save score');
    }
  };

  const sendAccessLink = async (panelMemberId, name) => {
    setError(''); setLinkMessage('');
    try {
      const res = await staffClient.post(`/api/interviews/panel-members/${panelMemberId}/access-link`);
      setLinkMessage(
        res.data.emailed
          ? `Scoring link (re)sent to ${name}. Any previous link for them is now invalid.`
          : `${name} has no email on file. Share this link directly - it replaces any previous link: ${res.data.url}`
      );
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate scoring link');
    }
  };

  // --- Finalize recommendation ---
  const openFinalize = (interviewId) => {
    setRecommendation('Shortlist'); setError('');
    setFinalizeModal({ interviewId });
  };
  const submitFinalize = async () => {
    try {
      await staffClient.patch(`/api/interviews/${finalizeModal.interviewId}/finalize`, { recommendation });
      setFinalizeModal(null);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not finalize recommendation');
    }
  };

  const approveOffer = async (offerId) => {
    await staffClient.patch(`/api/applications/offers/${offerId}/approve`);
    load();
  };

  const recommendOffer = async (applicationId) => {
    setError('');
    try {
      await staffClient.post(`/api/applications/${applicationId}/recommend-offer`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not recommend offer');
    }
  };

  const fileLink = (url) => {
    if (!url) return null;
    const token = localStorage.getItem('staffToken');
    return `${url}?token=${token}`;
  };

  if (!vacancy) return <p>Loading...</p>;

  const appsById = Object.fromEntries(applications.map((a) => [a.id, a]));
  const rankedApps = shortlistOrder.map((appId) => appsById[appId]).filter(Boolean);

  return (
    <div>
      <PageHeader
        title={vacancy.title}
        subtitle={`${vacancy.department} \u00b7 ${vacancy.positionsRequired} position(s) required`}
      />
      <p><StatusBadge status={vacancy.status} /></p>
      <Alert type="error" message={error} />
      <Alert type="info" message={linkMessage} />

      <h3>Shortlist ranking</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
        Drag to reorder. The top {vacancy.positionsRequired} become Primary; the rest become Reserve automatically.
      </p>
      {rankedApps.map((app, index) => (
        <Card
          key={app.id}
          accent={index < vacancy.positionsRequired ? 'var(--color-accent)' : 'var(--color-warning)'}
          style={{ cursor: 'grab' }}
        >
          <div
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIndex !== null) moveInOrder(dragIndex, index); setDragIndex(null); }}
          >
            #{index + 1} &mdash; {app.candidate.fullName} ({app.candidate.candidateType})
            {' '}&middot; {index < vacancy.positionsRequired ? 'Primary' : 'Reserve'}
          </div>
        </Card>
      ))}
      {rankedApps.length > 0 && <Button onClick={saveRanking}>Save ranking &amp; shortlist</Button>}

      <h3 style={{ marginTop: 24 }}>All applications</h3>
      {applications.map((app) => (
        <Card key={app.id}>
          <strong>{app.candidate.fullName}</strong> ({app.candidate.candidateType}) &mdash; <StatusBadge status={app.status} />
          {app.rank && <span> &middot; Rank {app.rank} ({app.listStatus})</span>}
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0' }}>
            CV: {app.cvUrl ? <a href={fileLink(app.cvUrl)} target="_blank" rel="noreferrer">view</a> : 'none'}
          </div>

          {app.candidate.candidateType === 'Internal' && app.candidate.internalProfile && (
            <Card accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)', marginBottom: 8 }}>
              <strong>Internal verification:</strong> <StatusBadge status={app.candidate.internalProfile.verificationStatus} />
              {app.candidate.internalProfile.verificationStatus !== 'HR_Verified' && (
                <div style={{ marginTop: 8 }}>
                  <Button variant="secondary" onClick={() => openVerify(app.candidate.id, 'HR_Verified')}>Mark HR Verified</Button>{' '}
                  <Button variant="ghost" onClick={() => openVerify(app.candidate.id, 'Discrepancy_Flagged')}>Flag discrepancy</Button>
                </div>
              )}
            </Card>
          )}

          {app.interviewRounds.map((r) => (
            <Card key={r.id} accent="var(--color-border)" style={{ background: 'var(--color-bg-subtle)' }}>
              <strong>Round {r.roundNumber}</strong>
              {' \u00b7 '}{r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : 'unscheduled'}
              {' \u00b7 '}{r.mode}
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
                        <Button variant="ghost" style={{ marginLeft: 4, padding: '2px 8px' }} onClick={() => sendAccessLink(p.id, p.name)}>
                          Send/regenerate scoring link
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
              <Button variant="secondary" onClick={() => openSchedule(app.id)}>
                {app.interviewRounds.length === 0 ? 'Schedule interview' : 'Schedule another round'}
              </Button>
            )}
            {app.status === 'Interviewed' && !app.offer && (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Principal_HR_Officer && (
              <Button style={{ marginLeft: 8 }} onClick={() => recommendOffer(app.id)}>Recommend for offer</Button>
            )}
            {app.offer && (ROLE_RANK[staff?.role] || 0) >= ROLE_RANK.Manager && app.offer.status === 'Recommended' && (
              <Button onClick={() => approveOffer(app.offer.id)}>Approve offer</Button>
            )}
            {app.offer && <span style={{ marginLeft: 8 }}>Offer: <StatusBadge status={app.offer.status} /></span>}
          </div>
        </Card>
      ))}

      {verifyModal && (
        <Modal
          title={verifyModal.decision === 'HR_Verified' ? 'Verify employment' : 'Flag discrepancy'}
          onClose={() => setVerifyModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setVerifyModal(null)}>Cancel</Button>
            <Button onClick={submitVerify}>Submit</Button>
          </>}
        >
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

      {interviewModal && (
        <Modal
          title="Schedule interview"
          onClose={() => setInterviewModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setInterviewModal(null)}>Cancel</Button>
            <Button onClick={submitSchedule}>Schedule</Button>
          </>}
        >
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

      {scoreModal && (
        <Modal
          title={`Record score \u2014 ${scoreModal.name}`}
          onClose={() => setScoreModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setScoreModal(null)}>Cancel</Button>
            <Button onClick={submitScore}>Save score</Button>
          </>}
        >
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 0 }}>
            Entered on this panelist's behalf - no login required for them.
          </p>
          <TextField label="Score (0-100)" type="number" min="0" max="100" value={scoreValue}
            onChange={(e) => setScoreValue(e.target.value)} />
          <TextArea label="Comments" value={scoreComments} onChange={(e) => setScoreComments(e.target.value)} />
        </Modal>
      )}

      {finalizeModal && (
        <Modal
          title="Finalize recommendation"
          onClose={() => setFinalizeModal(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setFinalizeModal(null)}>Cancel</Button>
            <Button onClick={submitFinalize}>Finalize</Button>
          </>}
        >
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
    </div>
  );
}
