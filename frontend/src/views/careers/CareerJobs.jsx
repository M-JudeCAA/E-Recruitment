import React, { useState } from 'react';
import Alert from '../../components/Alert';
import { PageTop, Chips } from '../../components/workspace/ui';
import { orgLabel } from '../../utils/orgNames';
import { SITE, CareerShell, useCareer, daysLeft } from './careers';
import { VacancyFitTable, ClosedVacancies } from './tables';

// Every open vacancy the candidate may apply for (Internal Careers:
// /careers/vacancies; public site: /dashboard/jobs), each checked against
// their profile, so they see at once where they can apply. Closed ones are
// folded away underneath.
export default function CareerJobs() {
  const { vacancies, closedVacancies, applications, fit, error } = useCareer({ fitFor: 'open' });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const list = vacancies || [];
  const words = q.trim().toLowerCase();
  const searched = list.filter((v) => !words || `${v.title} ${v.jobRef} ${v.department?.name || ''} ${orgLabel(v.department)}`.toLowerCase().includes(words));
  const tests = {
    all: () => true,
    eligible: (v) => fit[v.id]?.eligible,
    closing: (v) => { const d = daysLeft(v.deadline); return d != null && d <= 7; }
  };
  const rows = searched.filter(tests[filter]);

  return (
    <CareerShell active="vacancies">
      <PageTop title={SITE.jobsLabel}
        subtitle={SITE.internal ? 'Open to UCAA employees only. Each is checked against your profile.' : `${list.length} open at UCAA. Each is checked against your profile.`} />
      <Alert type="error" message={error} />
      <div className="ws-toolbar">
        <input className="ws-field grow" placeholder={`Title, department or ${SITE.jobWord} reference`} aria-label={`Search ${SITE.jobsLabel.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        <Chips style={{ marginLeft: 'auto' }} value={filter} onChange={setFilter} options={[
          { key: 'all', label: 'All', count: searched.length },
          { key: 'eligible', label: 'I can apply', count: searched.filter(tests.eligible).length },
          { key: 'closing', label: 'Closing this week', count: searched.filter(tests.closing).length }
        ]} />
      </div>
      <VacancyFitTable vacancies={vacancies ? rows : null} fit={fit} applications={applications} />
      {!SITE.internal && <ClosedVacancies vacancies={closedVacancies} />}
    </CareerShell>
  );
}
