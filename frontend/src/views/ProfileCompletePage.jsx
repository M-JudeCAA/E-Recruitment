import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ProfileCompletionForm from '../components/ProfileCompletionForm';

// New User's first-ever login lands here (see CandidateLogin.jsx) rather
// than the dashboard, so they complete their profile before anything
// else - unless an Advert User returnTo is pending, in which case
// CandidateLogin sends them to /apply/:id instead and ApplyForm shows
// the same form inside a modal there (see ApplyForm.jsx).
export default function ProfileCompletePage() {
  const navigate = useNavigate();

  return (
    <div style={{ background: 'var(--color-primary-light)', minHeight: '100%', width: '100%' }}>
      <div className="p-4 md:p-8">
        <div className="max-w-3xl mx-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', padding: 24 }}>
          <PageHeader title="Complete your profile" subtitle="A few more details before you can be considered for vacancies." />
          <ProfileCompletionForm onComplete={() => navigate('/dashboard')} />
        </div>
      </div>
    </div>
  );
}
