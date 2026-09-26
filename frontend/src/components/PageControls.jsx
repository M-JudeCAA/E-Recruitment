import React from 'react';
import Button from './Button';
import Spinner from './Spinner';

// Shared Previous/Next + "Page X of Y" footer for server-paginated lists -
// was duplicated near-verbatim across ApplicationManagement.jsx and
// ApprovalsCenter.jsx before this; new pages should use this instead of
// growing a third copy. `loading` shows a small inline spinner next to the
// page indicator (a page transition re-fetches, it doesn't just re-render)
// and disables both buttons for the duration.
export default function PageControls({ page, totalPages, onPrev, onNext, loading = false }) {
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, margin: '16px 0' }}>
      <Button variant="ghost" disabled={page <= 1 || loading} onClick={onPrev}>Previous</Button>
      <span style={{ fontSize: 13, color: 'var(--color-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {loading && <Spinner size={12} />} Page {page} of {totalPages}
      </span>
      <Button variant="ghost" disabled={page >= totalPages || loading} onClick={onNext}>Next</Button>
    </div>
  );
}
