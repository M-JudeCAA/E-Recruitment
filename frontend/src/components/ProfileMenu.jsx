import React, { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import Avatar from './Avatar';
import Button from './Button';

// Click-to-open account panel replacing the navbar's old always-visible
// [icon + name/role chip] + separate logout button with a single control -
// same collapsed-by-default, click-outside-to-close pattern as
// NotificationBell, just anchored off an avatar instead of a bell.
export default function ProfileMenu({ name, subtitle, email, avatarSrc, onLogout, logoutLabel = 'Sign out' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const displayName = name || 'Account';

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        title={displayName}
        style={{ display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <Avatar
          src={avatarSrc}
          name={name}
          size={32}
          background="rgba(255,255,255,0.15)"
          border="1px solid rgba(255,255,255,0.4)"
          iconColor="#FFFFFF"
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 10, width: 280,
            background: 'var(--color-bg)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 20, padding: 20
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
            <Avatar
              src={avatarSrc}
              name={name}
              size={56}
              background="var(--color-primary-light)"
              border="1px solid var(--color-border)"
              iconColor="var(--color-primary)"
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{displayName}</div>
              {email && <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>{email}</div>}
              {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{subtitle}</div>}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', margin: '16px 0' }} />

          <Button variant="ghost" onClick={onLogout} style={{ width: '100%', justifyContent: 'center' }}>
            <LogOut size={14} /> {logoutLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
