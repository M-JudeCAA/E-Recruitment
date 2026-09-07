import TextField from '../../components/TextField';

// The real InternalProfile self-declaration - this whole step is skipped
// for External candidates (see ApplyForm.jsx's dynamic step list).
export default function InternalProfileStep({ internalProfile, set }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 16 }}>
        As an internal candidate, please confirm your current employment details. HR verifies this before your application can be shortlisted.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Employee ID" required value={internalProfile.employeeId || ''} onChange={set('employeeId')} />
        <TextField label="Date joined UCAA" type="date" required value={internalProfile.dateJoined || ''} onChange={set('dateJoined')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Current department" required value={internalProfile.department || ''} onChange={set('department')} />
        <TextField label="Current position" required value={internalProfile.position || ''} onChange={set('position')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Supervisor's name" required value={internalProfile.supervisorName || ''} onChange={set('supervisorName')} />
        <TextField label="Supervisor's email" type="email" required value={internalProfile.supervisorEmail || ''} onChange={set('supervisorEmail')} />
      </div>
    </div>
  );
}
