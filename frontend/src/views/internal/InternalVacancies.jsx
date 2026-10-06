import React, { useState } from 'react';
import Alert from '../../components/Alert';
import { PageTop, Chips } from '../../components/workspace/ui';
import { InternalShell, useCareer, daysLeft } from './careers';
import { VacancyFitTable } from './tables';

// Every open internal vacancy (/careers/vacancies), each checked against the
// employee's profile, so they see at once where they can apply.
export default function InternalVacancies() {
  const { vacancies, applications, fit, error } = useCareer({ fitFor: 'open' });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const list = vacancies || [];
  const words = q.trim().toLowerCase();
  const searched = list.filter((v) => !words || `${v.title} ${v.jobRef} ${v.department?.name || ''}`.toLowerCase().includes(words));
  const tests = {
    all: () => true,
    eligible: (v) => fit[v.id]?.eligible,
    closing: (v) => { const d = daysLeft(v.deadline); return d != null && d <= 7; }
  };
  const rows = searched.filter(tests[filter]);

  return (
    <InternalShell active="vacancies">
      <PageTop title="Vacancies" subtitle="Open to UCAA employees only. Each is checked against your profile." />
      <Alert type="error" message={error} />
      <div className="ws-toolbar">
        <input className="ws-field grow" placeholder="Title, department or job reference" aria-label="Search vacancies" value={q} onChange={(e) => setQ(e.target.value)} />
        <Chips style={{ marginLeft: 'auto' }} value={filter} onChange={setFilter} options={[
          { key: 'all', label: 'All', count: searched.length },
          { key: 'eligible', label: 'I can apply', count: searched.filter(tests.eligible).length },
          { key: 'closing', label: 'Closing soon', count: searched.filter(tests.closing).length }
        ]} />
      </div>
      <VacancyFitTable vacancies={vacancies ? rows : null} fit={fit} applications={applications} />
    </InternalShell>
  );
}
