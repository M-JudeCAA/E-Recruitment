import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';

export default function Home() {
  const [vacancies, setVacancies] = useState([]);
  const { candidate } = useAuth();

  useEffect(() => {
    const params = candidate ? { candidateType: candidate.candidateType } : {};
    client.get('/api/vacancies', { params }).then((res) => setVacancies(res.data));
  }, [candidate]);

  return (
    <div>
      <PageHeader title="Open vacancies" />
      {vacancies.length === 0 && <p style={{ color: 'var(--color-text-muted)' }}>No open vacancies at the moment.</p>}
      {vacancies.map((v) => (
        <Card key={v.id}>
          <h3 style={{ margin: '0 0 4px' }}>{v.title}</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--color-text-muted)' }}>
            {v.department} &middot; {v.positionsRequired} position(s) &middot; <StatusBadge status={v.status} />
          </p>
          {v.deadline && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            Deadline: {new Date(v.deadline).toLocaleDateString()}
          </p>}
          <Link to={`/apply/${v.id}`}>Apply</Link>
        </Card>
      ))}
    </div>
  );
}
