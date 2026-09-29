import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import staffClient from '../../models/staffApiClient';
import Card from '../Card';
import Alert from '../Alert';
import Avatar from '../Avatar';
import LoadingState from '../LoadingState';
import PageControls from '../PageControls';
import OfferSummary from './OfferSummary';
import OfferActions from './OfferActions';
import { chipStyle, hintText } from '../interviews/formStyles';
import { errorMessage } from '../../utils/interviews';

// Every offer across every vacancy, by where it stands: waiting on an
// approver, returned to HR, out with the candidate (and whether their
// deadline is close), or decided. Each card carries the actions the viewer
// can take and a link back to the vacancy's merit list, where offers start.

const PAGE_SIZE = 15;
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'Recommended', label: 'Awaiting approval' },
  { key: 'Returned', label: 'Returned' },
  { key: 'Approved', label: 'With candidate' },
  { key: 'expiring', label: 'Deadline within 3 days' },
  { key: 'Accepted', label: 'Accepted' },
  { key: 'Declined', label: 'Declined' },
  { key: 'Expired', label: 'Expired' },
  { key: 'Withdrawn', label: 'Withdrawn' }
];

export default function OfferTracker({ staffRole, reloadKey }) {
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    const params = { page, limit: PAGE_SIZE };
    if (filter === 'expiring') params.expiringSoon = 'true';
    else if (filter) params.status = filter;
    staffClient.get('/api/applications/offers', { params })
      .then((res) => setResult(res.data))
      .catch((err) => setError(errorMessage(err, 'Could not load offers')))
      .finally(() => setLoading(false));
  }, [filter, page]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const countFor = (key) => {
    if (!result) return null;
    if (key === '') return Object.values(result.counts).reduce((a, b) => a + b, 0);
    if (key === 'expiring') return result.expiringSoon;
    return result.counts[key] || 0;
  };
  const totalPages = result ? Math.max(Math.ceil(result.total / PAGE_SIZE), 1) : 1;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        {FILTERS.map((f) => {
          const count = countFor(f.key);
          const alert = f.key === 'expiring' && count > 0;
          return (
            <button key={f.key || 'all'} type="button" style={{ ...chipStyle(filter === f.key), ...(alert ? { borderColor: 'var(--color-danger)' } : {}) }}
              onClick={() => { setFilter(f.key); setPage(1); }}>
              {f.label}{count != null && <strong style={{ marginLeft: 4, color: alert ? 'var(--color-danger)' : undefined }}>{count}</strong>}
            </button>
          );
        })}
      </div>

      <Alert type="error" message={error} />
      {!result && loading && <LoadingState />}
      {result && result.data.length === 0 && (
        <Card><p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
          {filter ? 'No offers match this filter.' : 'No offers yet. Offers are recommended from a vacancy\'s approved merit list.'}
        </p></Card>
      )}
      {result?.data.map((offer) => {
        const app = offer.application;
        return (
          <Card key={offer.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Avatar name={app.candidate.fullName} size={30} />
                <div style={{ minWidth: 0 }}>
                  <strong>{app.candidate.fullName}</strong> <span style={hintText}>{app.candidate.candidateType}</span>
                  <div style={hintText}>
                    {app.vacancy.jobRef} · {app.vacancy.title}
                    {app.meritRank && ` · merit list #${app.meritRank} (${app.meritListStatus})`}
                    {app.vacancy.positionsRequired > 1 && ` · ${app.vacancy.positionsRequired} positions`}
                  </div>
                </div>
              </div>
              <Link to={`/hr/applications?vacancyId=${app.vacancy.id}&stage=merit`} style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Trophy size={13} /> Merit list
              </Link>
            </div>
            <OfferSummary offer={offer} />
            <div style={{ marginTop: 8 }}>
              <OfferActions offer={offer} applicationId={app.id} staffRole={staffRole} onChanged={load} />
            </div>
          </Card>
        );
      })}
      {result && result.total > PAGE_SIZE && (
        <PageControls page={page} totalPages={totalPages} loading={loading} onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
      )}
    </div>
  );
}
