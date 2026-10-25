import TextField from '../../components/TextField';
import ExamGradesEditor from '../../components/ExamGradesEditor';
import ProfileEntriesEditor from '../../components/ProfileEntriesEditor';

// The candidate's personal details and their education, work experience and
// certificates (ProfileEntriesEditor: each entry edited in place and saved as
// it is filled in). Entries are candidate-level, not application-level - they
// persist across every application this candidate ever submits.
// showPersonalDetails={false} leaves out the personal details block - Internal
// Careers asks for those in its own short form and uses this for the entries.
// focusEntry ({ kind, id }) opens that one entry (My profile's Edit on it);
// entryKinds and startNew pass through to ProfileEntriesEditor (My profile's
// "+ Add" opens just that section's form); entriesRef reaches the editor, for
// a panel's Done (finish()). O-Level and A-Level results sit inside the
// Education section.
export default function ProfileStep({
  profile, onProfileChange, profileDetails, setProfileDetail, showPersonalDetails = true,
  focusEntry = null, entryKinds = undefined, startNew = null, entriesRef = undefined
}) {
  return (
    <div>
      {showPersonalDetails && (<>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Personal details</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Name, email, and phone come from your account. The rest is used for this and future applications.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Full name" value={profile?.fullName || ''} disabled />
        <TextField label="Email" value={profile?.email || ''} disabled />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Phone" value={profile?.phone || ''} disabled />
        <TextField label="Place of residence" required hint="Town or district, country" value={profileDetails.location} onChange={setProfileDetail('location')} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="National Identification Number (NIN)" required hint="As it appears on your National ID card" maxLength={14}
          value={profileDetails.nationalId} onChange={setProfileDetail('nationalId')} />
        <TextField label="District of origin" required hint="The Ugandan district you come from" maxLength={100}
          value={profileDetails.districtOfOrigin} onChange={setProfileDetail('districtOfOrigin')} />
      </div>
      <TextField label="LinkedIn or personal site" hint="Optional" placeholder="linkedin.com/in/..."
        value={profileDetails.linkedinUrl} onChange={setProfileDetail('linkedinUrl')} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ maxWidth: 640 }}>
        <TextField label="Date of birth" type="date" hint="Optional - only needed if a role sets an age requirement"
          value={profileDetails.dateOfBirth} onChange={setProfileDetail('dateOfBirth')} />
        <TextField label="Total flying hours" type="number" min="0" hint="Optional - only relevant to flight-crew roles"
          value={profileDetails.flyingHours} onChange={setProfileDetail('flyingHours')} />
      </div>

      </>)}

      <div style={{ marginTop: showPersonalDetails ? 24 : 0 }}>
        <ProfileEntriesEditor ref={entriesRef} profile={profile} onSaved={onProfileChange} focus={focusEntry} kinds={entryKinds} startNew={startNew}
          educationExtra={<ExamGradesEditor examGrades={profile?.examGrades} onChange={onProfileChange} />} />
      </div>
    </div>
  );
}
