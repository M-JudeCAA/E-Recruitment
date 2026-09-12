import { useRef, useState } from 'react';
import client from '../models/apiClient';
import { useAuth } from '../models/AuthContext';
import Avatar from './Avatar';
import Button from './Button';
import Alert from './Alert';
import { candidateFileSrc } from '../utils/fileSrc';

// Optional avatar upload, shown wherever ProfileCompletionForm is (the
// dedicated My Profile page, and the New User /profile/complete page).
// Mirrors CvAutofillPanel's own upload pattern (FormData -> multipart
// POST/PUT, busy/error state via the same Alert component) rather than
// introducing a new one. `photoUrl`/`onChange` are controlled by the
// parent so the rest of the form's already-loaded profile state stays
// the single source of truth - this panel doesn't keep its own copy.
export default function PhotoUploadPanel({ photoUrl, onChange }) {
  const { updateCandidatePhoto } = useAuth();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await client.put('/api/candidates/me/photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onChange(res.data.photoUrl);
      updateCandidatePhoto(res.data.photoUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload photo');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove your profile photo?')) return;
    setError('');
    setRemoving(true);
    try {
      await client.delete('/api/candidates/me/photo');
      onChange(null);
      updateCandidatePhoto(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove photo');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
      <Avatar src={candidateFileSrc(photoUrl)} size={72} />
      <div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Profile photo</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Optional - JPG, PNG, or WEBP, up to 3MB.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFile}
            disabled={uploading}
            style={{ display: 'none' }}
          />
          <Button
            type="button" variant="secondary" loading={uploading} loadingText="Uploading..."
            onClick={() => fileInputRef.current?.click()}
          >
            {photoUrl ? 'Change photo' : 'Upload photo'}
          </Button>
          {photoUrl && (
            <Button
              type="button" variant="ghost" loading={removing} loadingText="Removing..."
              onClick={handleRemove} style={{ color: 'var(--color-danger)' }}
            >
              Remove
            </Button>
          )}
        </div>
        {error && <Alert type="error" message={error} />}
      </div>
    </div>
  );
}
