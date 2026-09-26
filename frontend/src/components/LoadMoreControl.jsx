import React from 'react';
import Button from './Button';

// Client-side "Load more" - the display-only pagination this codebase
// prefers when a list is already fetched whole in one bounded request (see
// HRDashboard.jsx's own original comment on this pattern). `total` is the
// full filtered/sorted count; `visibleCount` is how many are currently
// rendered. Renders nothing once everything visible is already showing.
export default function LoadMoreControl({ total, visibleCount, onLoadMore, pageSize }) {
  if (total <= visibleCount) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
      <Button variant="ghost" onClick={onLoadMore}>
        Load more ({total - visibleCount} remaining)
      </Button>
    </div>
  );
}
