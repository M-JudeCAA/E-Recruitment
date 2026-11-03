import React from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import Card from '../components/Card';
import EmailNotificationsCard from '../components/EmailNotificationsCard';

// /email-preferences/:token - where the "Stop these emails" link in every
// candidate notice email leads, on either site, with no sign-in needed (the
// token is signed for that one account). Open while the public site is
// closed, like the privacy notice.
export default function EmailPreferences() {
  const { token } = useParams();
  return (
    <div style={{ maxWidth: 640 }}>
      <PageHeader title="Email settings" subtitle="UCAA e-Recruitment" />
      <Card><EmailNotificationsCard token={token} /></Card>
    </div>
  );
}
