import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';

// Shared shell behind HRSidebar/CandidateSidebar - both were identical
// aside-in-a-flex-row layouts (same sticky positioning, same link markup),
// differing only in their item list and width, so the foldable/responsive
// behavior below lives here once instead of being duplicated twice.
//
// Two independent behaviors, both driven by screen width via Tailwind's
// responsive classes rather than a resize listener (the apply wizard's
// StepperRail already establishes that pattern in this codebase - see its
// own hidden/md:block split):
//   - >= md: inline sticky sidebar, same as before, plus a manual
//     collapse toggle to an icon-only rail (remembered per-device via
//     localStorage, keyed separately per sidebar so a staff member's
//     collapse choice doesn't affect the candidate side or vice versa).
//   - < md: the inline sidebar is removed from layout entirely (display:
//     none via `hidden`) rather than squeezed into the flex row, since
//     nothing here has flex-wrap and squeezing would just cause
//     horizontal overflow. A floating button opens it as a slide-in
//     overlay drawer instead.
//
// IMPORTANT: elements carrying the `hidden`/`md:block`/`md:hidden`
// classes below must never also set `display` in their inline `style` -
// an inline style's `display` always wins over any class (media query or
// not), which would silently defeat the responsive switch.
export default function Sidebar({ items, active, storageKey, width = 250 }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        // Private browsing / blocked storage - the toggle still works for
        // this render, it just won't be remembered next visit.
      }
      return next;
    });
  };

  // `forceExpanded` lets the mobile drawer always show full labels
  // regardless of the desktop icon-rail preference - `collapsed` is a
  // desktop-only concept (an inline sidebar sitting there permanently),
  // and shouldn't leak into a drawer that's opened on demand and has
  // plenty of width for text.
  function renderLinks(onNavigate, forceExpanded) {
    const iconOnly = collapsed && !forceExpanded;
    return items.map(({ key, label, icon: Icon, to }) => {
      const isActive = active === key;
      return (
        <Link
          key={key}
          to={to}
          title={iconOnly ? label : undefined}
          onClick={onNavigate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: iconOnly ? 0 : 10,
            justifyContent: iconOnly ? 'center' : 'flex-start',
            width: '100%',
            boxSizing: 'border-box',
            textDecoration: 'none',
            padding: iconOnly ? '10px 0' : '10px 12px',
            marginBottom: 4,
            borderRadius: 'var(--radius-sm)',
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            background: isActive ? 'var(--color-primary)' : 'transparent',
            color: isActive ? '#FFFFFF' : 'var(--color-text)',
          }}
        >
          <Icon size={16} style={{ flexShrink: 0 }} />
          {!iconOnly && label}
        </Link>
      );
    });
  }

  return (
    <>
      {/* Desktop/tablet - sticky, foldable */}
      <aside
        className="hidden md:block"
        style={{
          width: collapsed ? 64 : width,
          flexShrink: 0,
          background: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--spacing-sm)',
          boxSizing: 'border-box',
          position: 'sticky',
          top: 'calc(var(--navbar-height) + var(--spacing-md))',
          maxHeight: 'calc(100vh - var(--navbar-height) - var(--footer-height) - var(--spacing-lg))',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 0.15s ease',
        }}
      >
        {renderLinks()}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 8,
            width: '100%',
            marginTop: 8,
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            borderTop: '1px solid var(--color-border)',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && 'Collapse'}
        </button>
      </aside>

      {/* Mobile - floating trigger; the inline aside above is hidden below
          md, not squeezed, so this is the only way to reach it there. */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="md:hidden flex items-center justify-center"
        style={{
          position: 'fixed',
          // Above the fixed Footer (zIndex 100, var(--footer-height) tall)
          // rather than under it - Footer.jsx's full-width bar otherwise
          // intercepts clicks in this corner even though nothing is
          // visibly drawn there.
          bottom: 'calc(var(--footer-height) + var(--spacing-md))',
          left: 20,
          zIndex: 90,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: 'var(--color-primary)',
          color: '#FFFFFF',
          border: 'none',
          boxShadow: '0 4px 14px rgba(20,24,28,0.25)',
          cursor: 'pointer',
        }}
      >
        <Menu size={20} />
      </button>

      {mobileOpen && (
        <div
          className="md:hidden"
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }}
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: 260,
              maxWidth: '80vw',
              background: 'var(--color-bg)',
              borderRight: '1px solid var(--color-border)',
              padding: 'var(--spacing-sm)',
              boxSizing: 'border-box',
              overflowY: 'auto',
              boxShadow: '4px 0 16px rgba(0,0,0,0.15)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>
            {renderLinks(() => setMobileOpen(false), true)}
          </aside>
        </div>
      )}
    </>
  );
}
