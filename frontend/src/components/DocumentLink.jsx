import React, { useCallback, useState } from 'react';
import DocumentPreview from './DocumentPreview';

// The link to any uploaded document: a click opens it in the in-app viewer
// (DocumentPreview), never a download - the viewer has the Download button.
// url is the stored file's path (/api/files/... or a committee link's file
// path), name what the document is called (also the downloaded file's
// name), audience whose session opens it ('staff' | 'candidate' | 'committee').
export default function DocumentLink({ url, name, audience = 'staff', children, className, style, title }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!url) return null;
  return (
    <>
      <button type="button" className={['doc-link', className].filter(Boolean).join(' ')} style={style} title={title || `Preview ${name || 'document'}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        {children || name || 'View document'}
      </button>
      {open && <DocumentPreview url={url} name={name} audience={audience} onClose={close} />}
    </>
  );
}
