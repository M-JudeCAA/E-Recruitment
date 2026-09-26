import React from 'react';
import { User } from 'lucide-react';

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Shared circular avatar - an image when `src` is given, initials when
// `name` is given instead (ProfileMenu's account panel), else the same
// generic lucide User icon used as the profile chip's placeholder so a
// user with neither reads consistently with the existing pattern. Colors
// are passed in rather than hardcoded so it can sit on either the navy
// navbar or a plain white card.
export default function Avatar({ src, name, size = 32, background = 'var(--color-bg-subtle)', border = '1px solid var(--color-border)', iconColor = 'var(--color-text-muted)' }) {
  const initials = !src && name ? getInitials(name) : '';
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
        : initials
        ? <span style={{ fontSize: Math.round(size * 0.4), fontWeight: 700, color: iconColor, lineHeight: 1 }}>{initials}</span>
        : <User size={Math.round(size * 0.5)} color={iconColor} />}
    </span>
  );
}
