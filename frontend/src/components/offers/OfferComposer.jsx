import React, { useEffect, useState } from 'react';
import { Trophy, AlertTriangle } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Modal from '../Modal';
import Button from '../Button';
import Alert from '../Alert';
import TextField from '../TextField';
import Select from '../Select';
import TextArea from '../TextArea';
import StatusBadge from '../StatusBadge';
import BulletListEditor from '../BulletListEditor';
import LoadingState from '../LoadingState';
import { hintText } from '../interviews/formStyles';
import { errorMessage } from '../../utils/interviews';
import { EMPLOYMENT_LABELS, MIN_RESPONSE_DAYS, MAX_RESPONSE_DAYS, formatDate } from './offerFormat';

// Drafts an offer for a Primary candidate on the approved merit list, or
// revises one that is awaiting approval or was returned. The terms are what
// the approver signs off and what the candidate is asked to accept, so they
// are captured here once, up front (backend offerService.parseTerms).

const toDateInput = (value) => (value ? new Date(value).toISOString().slice(0, 10) : '');

function termsFrom(source) {
  return {
    salaryAmount: source.salaryAmount != null ? String(Number(source.salaryAmount)) : '',
    salaryCurrency: source.salaryCurrency || 'UGX',
    salaryPeriod: source.salaryPeriod || 'Monthly',
    allowances: source.allowances || '',
    employmentCategory: source.employmentCategory || 'FullTime',
    contractMonths: source.contractMonths ? String(source.contractMonths) : '',
    startDate: toDateInput(source.startDate),
    dutyStation: source.dutyStation || '',
    conditions: Array.isArray(source.conditions) ? source.conditions : [],
    responseDays: String(source.responseDays || 14)
  };
}

export default function OfferComposer({ applicationId, onClose, onSaved }) {
  const [context, setContext] = useState(null);
  const [terms, setTerms] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    staffClient.get(`/api/applications/${applicationId}/offer-draft`)
      .then((res) => {
        setContext(res.data);
        setTerms(termsFrom(res.data.offer?.salaryAmount != null ? res.data.offer : res.data.suggested));
      })
      .catch((err) => setError(errorMessage(err, 'Could not load this candidate')));
  }, [applicationId]);

  const existing = context?.offer;
  const set = (key) => (e) => setTerms((t) => ({ ...t, [key]: e.target.value }));
  const isContract = terms && terms.employmentCategory !== 'FullTime';
  const days = Number(terms?.responseDays) || 0;
  const deadlinePreview = days ? new Date(Date.now() + days * 86400000) : null;

  const save = async () => {
    setSaving(true); setError('');
    const body = {
      ...terms,
      salaryAmount: Number(terms.salaryAmount),
      contractMonths: isContract ? Number(terms.contractMonths) : null,
      responseDays: Number(terms.responseDays)
    };
    try {
      if (existing) await staffClient.patch(`/api/applications/offers/${existing.id}`, body);
      else await staffClient.post(`/api/applications/${applicationId}/recommend-offer`, body);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save this offer'));
    } finally {
      setSaving(false);
    }
  };

  const title = context ? `${existing ? 'Revise offer' : 'Recommend offer'} — ${context.candidate.fullName}` : 'Offer';
  const blocked = context && !existing && context.blocker;

  return (
    <Modal
      title={title} onClose={onClose} maxWidth={720}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        {context && !blocked && (
          <Button onClick={save} loading={saving} loadingText="Saving...">
            {existing ? (existing.status === 'Returned' ? 'Resubmit for approval' : 'Save changes') : 'Send for approval'}
          </Button>
        )}
      </>}
    >
      <Alert type="error" message={error} />
      {!context && !error && <LoadingState />}
      {context && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', marginBottom: 12,
            background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-sm)', fontSize: 13
          }}>
            <Trophy size={15} color="var(--color-primary)" />
            <strong>{context.vacancy.jobRef} · {context.vacancy.title}</strong>
            {context.merit.rank && <StatusBadge status={context.merit.listStatus || 'Pending'} label={`Merit #${context.merit.rank} ${context.merit.listStatus || ''}`} />}
            {context.merit.recommendation && <StatusBadge status={context.merit.recommendation} />}
            {context.merit.interviewScore != null && <span style={hintText}>interview score {context.merit.interviewScore}</span>}
            {context.vacancy.salaryScale && <span style={hintText}>· advertised scale {context.vacancy.salaryScale}</span>}
          </div>

          {blocked && <Alert type="error" message={context.blocker} />}
          {existing?.status === 'Returned' && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', marginBottom: 12, fontSize: 13,
              border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-sm)'
            }}>
              <AlertTriangle size={15} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>Returned{existing.returnedBy?.name ? ` by ${existing.returnedBy.name}` : ''}:</strong> {existing.returnReason}
              </span>
            </div>
          )}

          {!blocked && terms && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
                <TextField label="Salary" type="number" min="0" required value={terms.salaryAmount} onChange={set('salaryAmount')} />
                <TextField label="Currency" value={terms.salaryCurrency} maxLength={3} onChange={set('salaryCurrency')} />
                <Select label="Per" value={terms.salaryPeriod} onChange={set('salaryPeriod')}>
                  <option value="Monthly">Month</option>
                  <option value="Annual">Year</option>
                </Select>
              </div>
              <TextArea label="Allowances and benefits (optional)" value={terms.allowances} onChange={set('allowances')}
                placeholder="e.g. Housing allowance UGX 800,000 / month; medical cover for staff and dependants" />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <Select label="Employment" value={terms.employmentCategory} onChange={set('employmentCategory')}>
                  {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
                {isContract && (
                  <TextField label="Contract length (months)" type="number" min="1" max="120" required value={terms.contractMonths} onChange={set('contractMonths')} />
                )}
                <TextField label="Start date" type="date" required value={terms.startDate} onChange={set('startDate')} />
                <TextField label="Duty station" value={terms.dutyStation} onChange={set('dutyStation')} />
              </div>

              <BulletListEditor
                label="Conditions of the offer"
                hint="What the appointment depends on - shown to the candidate as written."
                items={terms.conditions}
                onChange={(conditions) => setTerms((t) => ({ ...t, conditions }))}
                placeholder="Add a condition"
              />

              <div>
                <TextField
                  label="Days the candidate has to respond" type="number" min={MIN_RESPONSE_DAYS} max={MAX_RESPONSE_DAYS}
                  value={terms.responseDays} onChange={set('responseDays')} style={{ maxWidth: 220 }}
                />
                <div style={hintText}>
                  Counted from approval. If approved today, the candidate must answer by <strong>{formatDate(deadlinePreview)}</strong>;
                  they get a reminder two days before, and an unanswered offer expires and passes to the next reserve.
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
