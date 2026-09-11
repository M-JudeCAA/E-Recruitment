import React from 'react';
import PageHeader from '../components/PageHeader';
import AvailableJobsList from '../components/AvailableJobsList';

export default function Home() {
  return (
    <div>
      <PageHeader title="Open vacancies" />
      <AvailableJobsList />
    </div>
  );
}
