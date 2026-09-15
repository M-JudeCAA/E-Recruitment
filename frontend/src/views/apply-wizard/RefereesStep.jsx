import TextField from '../../components/TextField';

// Application-level, like the Questions step (not candidate-level like
// Education/WorkExperience on the Profile step) - who a candidate names as
// a reference is naturally job-specific, so it isn't meant to silently
// carry over unedited to every other application. Always exactly 3 fixed
// slots (not a repeatable add-list like Education) since UCAA's
// application form asks for a set number of referees, not an open-ended
// list.
export default function RefereesStep({ referees, setReferee }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
        Provide three people who can speak to your work - a former supervisor, colleague, or someone else who
        knows your professional conduct well. HR may contact them as part of this application.
      </p>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ marginBottom: 24, paddingBottom: 20, borderBottom: i < 2 ? '1px solid var(--color-border)' : 'none' }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>Referee {i + 1}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Full name" required value={referees[i]?.name || ''} onChange={setReferee(i, 'name')} />
            <TextField label="Relationship to you" hint="e.g. Former supervisor" value={referees[i]?.relationship || ''} onChange={setReferee(i, 'relationship')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
            <TextField label="Organization" hint="Optional" value={referees[i]?.organization || ''} onChange={setReferee(i, 'organization')} />
            <TextField label="Phone" required value={referees[i]?.phone || ''} onChange={setReferee(i, 'phone')} />
          </div>
          <TextField label="Email" required type="email" value={referees[i]?.email || ''} onChange={setReferee(i, 'email')} />
        </div>
      ))}
    </div>
  );
}
