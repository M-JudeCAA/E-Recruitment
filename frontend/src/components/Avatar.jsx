import React from 'react';
import { User } from 'lucide-react';

// Shared circular avatar - an image when `src` is given, else the same
// generic lucide User icon used as the staff profile chip's placeholder
// (Navbar.jsx) so a candidate with no photo reads consistently with that
// existing pattern. Colors are passed in rather than hardcoded so it can
// sit on either the navy navbar or a plain white card.
export default function Avatar({ src, size = 32, background = 'var(--color-bg-subtle)', border = '1px solid var(--color-border)', iconColor = 'var(--color-text-muted)' }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background, border, overflow: 'hidden', boxSizing: 'border-box'
      }}
    >
      {src
        ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <User size={Math.round(size * 0.5)} color={iconColor} />}
    </span>
  );
}
