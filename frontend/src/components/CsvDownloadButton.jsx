import React, { useState } from 'react';
import { Download } from 'lucide-react';
import staffClient from '../models/staffApiClient';
import Button from './Button';

// Downloads one of the HR CSV exports (backend exportController). Fetched
// with the staff session's Authorization header and saved from a blob - the
// ?token= query param is reserved for /api/files and not extended here.

function filenameFrom(disposition, fallback) {
  const match = /filename="([^"]+)"/.exec(disposition || '');
  return match ? match[1] : fallback;
}

export default function CsvDownloadButton({ url, label, fallbackName = 'export.csv', style }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const download = async () => {
    setBusy(true); setError('');
    try {
      const res = await staffClient.get(url, { responseType: 'blob' });
      const href = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = href;
      link.download = filenameFrom(res.headers['content-disposition'], fallbackName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError('Could not download the export');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Button variant="ghost" onClick={download} loading={busy} loadingText="Preparing..." style={{ padding: '6px 12px', fontSize: 13, ...style }}>
        <Download size={14} /> {label}
      </Button>
      {error && <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)' }}>{error}</span>}
    </span>
  );
}
