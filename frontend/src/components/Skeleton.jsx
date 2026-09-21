import React from 'react';

// A single shimmering placeholder block - the shape (width/height/radius)
// is up to the caller, so a list of these can be composed into a
// placeholder that mimics the actual content's layout (a title line, a
// meta line, a badge) rather than a generic spinner. Use this instead of
// LoadingState wherever the content being awaited has a known, repeating
// shape (a list of rows/cards) - LoadingState's centered spinner still
// reads better for content with no such shape (a lone summary fetch, a
// cascading dropdown, a button's own busy state).
export default function Skeleton({ width = '100%', height = 14, radius = 4, style }) {
  return (
    <span
      className="skeleton-block"
      aria-hidden="true"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
    />
  );
}
