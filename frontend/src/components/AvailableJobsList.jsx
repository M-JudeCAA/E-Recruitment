import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import Card from './Card';
import StatusBadge from './StatusBadge';
import LoadingState from './LoadingState';

// Extracted from Home.jsx so the same "Open Jobs" listing is available
// wherever it's needed without duplicating the fetch/render logic. Now
// used only by Home.jsx itself - CandidateHome.jsx (the signed-in
// dashboard's landing page) has its own richer inline listing with
// search and pagination.
export default function AvailableJobsList() {
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);
  const { candidate } = useAuth();

  useEffect(() => {
    setLoading(true);
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params })
      .then((res) => setVacancies(res.data))
      .finally(() => setLoading(false));
  }, [candidate]);

  if (loading) return <LoadingState label="Loading open vacancies..." />;
  if (vacancies.length === 0) return <p style={{ color: 'var(--color-text-muted)' }}>No open vacancies at the moment.</p>;

  return (
    <>
      {vacancies.map((v) => (
        <Card key={v.id}>
          <h3 style={{ margin: '0 0 4px' }}>{v.title}</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted)' }}>
            {v.department?.name} &middot; {v.positionsRequired} position(s) &middot; <StatusBadge status={v.status} />
          </p>
          {v.deadline && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Deadline: {new Date(v.deadline).toLocaleDateString()}
          </p>}
          <Link to={`/apply/${v.id}`}>Apply</Link>
        </Card>
      ))}
    </>
  );
}
