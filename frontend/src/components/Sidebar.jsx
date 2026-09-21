import React from 'react';
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
//
// `items` entries: { key, label, icon, to, badge?, section? }. Consecutive
// items sharing the same `section` get one header rendered above the
// first of them (or a plain divider in icon-only mode, since there's no
// room for the label text) - items with no `section` render as a flat,
// ungrouped list at the top, for the one or two links (Home, Approvals
// Center) that don't belong to any functional group.
export default function Sidebar({ items, active, storageKey, width = 250, title }) {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = React.useState(false);

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

  // Header row: sidebar title (hidden once collapsed - no room) plus the
  // collapse toggle, always in the same spot at the top rather than
  // buried at the bottom, matching the collapse-affordance placement most
  // users already know from VS Code/Slack/Linear-style sidebars.
  function renderHeader() {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 8,
          paddingBottom: 10,
          marginBottom: 6,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {!collapsed && title && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </span>
        )}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: 26,
            height: 26,
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    );
  }

  // `forceExpanded` lets the mobile drawer always show full labels
  // regardless of the desktop icon-rail preference - `collapsed` is a
  // desktop-only concept (an inline sidebar sitting there permanently),
  // and shouldn't leak into a drawer that's opened on demand and has
  // plenty of width for text.
  // `badge` is an optional count (e.g. HRSidebar's Approvals Center item)
  // - a small pill after the label when expanded, or a dot over the icon
  // when collapsed/icon-only, so the "something needs you" signal survives
  // the fold instead of disappearing with the label.
  function renderNav(onNavigate, forceExpanded) {
    const iconOnly = collapsed && !forceExpanded;
    const nodes = [];
    let prevSection;
    items.forEach(({ key, label, icon: Icon, to, badge, section }) => {
      if (section && section !== prevSection) {
        nodes.push(
          iconOnly ? (
            <div key={`div-${section}`} style={{ height: 1, background: 'var(--color-border)', margin: '8px 6px' }} />
          ) : (
            <div
              key={`hdr-${section}`}
              style={{
                padding: '14px 10px 6px',
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--color-text-muted)',
              }}
            >
              {section}
            </div>
          )
        );
      }
      prevSection = section;

      const isActive = active === key;
      const showBadge = badge != null && badge > 0;
      nodes.push(
        <Link
          key={key}
          to={to}
          title={iconOnly ? (showBadge ? `${label} (${badge})` : label) : undefined}
          onClick={onNavigate}
          // Hover tint lives in theme.css's .sidebar-link rule, not inline
          // styles - inline `background` always wins over a CSS class, so
          // the active state below only sets it inline when true and
          // leaves it unset otherwise, letting the CSS hover rule show
          // through on inactive links.
          className="sidebar-link"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: iconOnly ? 0 : 10,
            justifyContent: iconOnly ? 'center' : 'flex-start',
            width: '100%',
            boxSizing: 'border-box',
            textDecoration: 'none',
            padding: iconOnly ? '10px 0' : '9px 12px',
            marginBottom: 2,
            borderRadius: 'var(--radius-sm)',
            fontSize: 14,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? 'var(--color-primary-dark)' : 'var(--color-text)',
            ...(isActive
              ? {
                  background: 'var(--color-primary-light)',
                  // Left accent bar reads as "you are here" without the
                  // heavier full-fill treatment the old design used -
                  // inset box-shadow instead of a border so it doesn't
                  // shift the row's padding/width.
                  boxShadow: iconOnly ? 'none' : 'inset 3px 0 0 0 var(--color-primary)',
                }
              : {}),
            position: 'relative',
          }}
        >
          <span
            style={{
              position: 'relative',
              display: 'flex',
              flexShrink: 0,
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
            }}
          >
            <Icon size={16} />
            {showBadge && iconOnly && (
              <span
                style={{
                  position: 'absolute', top: -4, right: -4, width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--color-danger)',
                }}
              />
            )}
          </span>
          {!iconOnly && <span style={{ flex: 1, minWidth: 0 }}>{label}</span>}
          {!iconOnly && showBadge && (
            <span
              style={{
                flexShrink: 0, minWidth: 18, padding: '0 5px', borderRadius: 999, textAlign: 'center',
                fontSize: 11, fontWeight: 700, lineHeight: '17px',
                background: 'var(--color-danger)',
                color: '#FFFFFF',
              }}
            >
              {badge}
            </span>
          )}
        </Link>
      );
    });
    return nodes;
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
          // Cleared past the fixed BreadcrumbNav bar too, not just the
          // Navbar - otherwise the sidebar's top edge would end up sliding
          // underneath that bar once the page is scrolled.
          top: 'calc(var(--navbar-height) + var(--breadcrumb-height) + var(--spacing-md))',
          maxHeight: 'calc(100vh - var(--navbar-height) - var(--breadcrumb-height) - var(--footer-height) - var(--spacing-lg))',
          overflowY: 'auto',
          overflowX: 'hidden',
          transition: 'width 0.15s ease',
        }}
      >
        {renderHeader()}
        {renderNav()}
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: 10,
                marginBottom: 6,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{title || 'Menu'}</span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>
            {renderNav(() => setMobileOpen(false), true)}
          </aside>
        </div>
      )}
    </>
  );
}
