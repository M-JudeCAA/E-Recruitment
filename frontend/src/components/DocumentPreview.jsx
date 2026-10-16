import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, X, FileText } from 'lucide-react';
import client, { API_URL } from '../models/apiClient';
import staffClient from '../models/staffApiClient';
import Spinner from './Spinner';

// Every document uploaded to the system opens here, in the page, when its
// link is clicked (DocumentLink) - it is only downloaded when the viewer's
// Download button is used. PDFs show in the browser's own viewer, images as
// they are, Word (.docx) files as text converted on the server
// (GET <file>/preview, utils/documentPreview.js) in a sandboxed frame. An old
// .doc can't be shown, so only its download is offered.
//
// audience says whose session opens it: 'staff', 'candidate', or
// 'committee' (a shortlisting committee member's private link, whose file
// URLs already carry their access).

const KIND_BY_EXTENSION = { pdf: 'pdf', jpg: 'image', jpeg: 'image', png: 'image', webp: 'image' };
const extensionOf = (url) => (/\.([a-z0-9]+)$/i.exec(String(url || '').split('?')[0])?.[1] || '').toLowerCase();

function token(audience) {
  if (audience === 'committee') return null;
  try { return localStorage.getItem(audience === 'candidate' ? 'candidateToken' : 'staffToken'); } catch { return null; }
}

/** The URLs for one stored file: shown in the page, downloaded, and the viewer's content. */
export function documentUrls(url, { audience = 'staff', name } = {}) {
  const t = token(audience);
  const query = (extra = {}) => {
    const params = new URLSearchParams(extra);
    if (t) params.set('token', t);
    const s = params.toString();
    return s ? `?${s}` : '';
  };
  return {
    view: `${API_URL}${url}${query()}`,
    download: `${API_URL}${url}${query({ download: '1', ...(name ? { name } : {}) })}`,
    preview: `${url}/preview`
  };
}

// A Word document's HTML, shown with no scripts and nothing from outside it.
const frameDocument = (html) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:820px;margin:0 auto;padding:28px 32px;}
table{border-collapse:collapse;margin:8px 0;}td,th{border:1px solid #c9d1d9;padding:4px 8px;vertical-align:top;}
img{max-width:100%;height:auto;}p{margin:0 0 8px;}
</style></head><body>${html}</body></html>`;

export default function DocumentPreview({ url, name, audience = 'staff', onClose }) {
  const ext = extensionOf(url);
  const shownByBrowser = KIND_BY_EXTENSION[ext];
  const [content, setContent] = useState(shownByBrowser ? { kind: shownByBrowser } : null);
  const [failed, setFailed] = useState(false);
  const urls = documentUrls(url, { audience, name });
  const title = name || 'Document';

  useEffect(() => {
    if (shownByBrowser) return undefined;
    let live = true;
    const get = audience === 'staff' ? staffClient.get : client.get;
    get(urls.preview)
      .then((res) => { if (live) setContent(res.data); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, audience]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const cannotShow = failed || content?.kind === 'none';
  let body;
  if (cannotShow) {
    body = (
      <div className="doc-viewer-msg">
        <FileText size={40} aria-hidden="true" />
        <p>{failed ? 'This document could not be shown here.' : 'This type of file can\'t be shown here (for example an older Word .doc).'}</p>
        <p className="ws-note">Download it to open it on your computer.</p>
        <a className="doc-viewer-btn primary" href={urls.download} download><Download size={15} /> Download</a>
      </div>
    );
  } else if (!content) {
    body = <div className="doc-viewer-msg"><Spinner size={24} /><p className="ws-note">Opening the document...</p></div>;
  } else if (content.kind === 'pdf') {
    body = <iframe className="doc-viewer-frame" src={urls.view} title={title} />;
  } else if (content.kind === 'image') {
    body = <div className="doc-viewer-image"><img src={urls.view} alt={title} /></div>;
  } else {
    body = <iframe className="doc-viewer-frame paper" sandbox="" srcDoc={frameDocument(content.html || '')} title={title} />;
  }

  return createPortal(
    // A click inside the viewer must not reach a clickable row it was opened from.
    <div className="modal-overlay doc-viewer-overlay" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="doc-viewer-h">
          <h2 title={title}>{title}</h2>
          <div className="doc-viewer-actions">
            {shownByBrowser && (
              <a className="doc-viewer-btn" href={urls.view} target="_blank" rel="noreferrer"><ExternalLink size={15} /> <span>Open in new tab</span></a>
            )}
            <a className="doc-viewer-btn" href={urls.download} download><Download size={15} /> <span>Download</span></a>
            <button type="button" className="ws-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </div>
        <div className="doc-viewer-b">{body}</div>
      </div>
    </div>,
    document.body
  );
}
