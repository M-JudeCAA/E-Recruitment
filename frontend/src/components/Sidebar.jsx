import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, LogOut, Plane } from 'lucide-react';

const COLLAPSE_KEY = 'sidebarCollapsed';
const EXPANDED_WIDTH = 232;
const COLLAPSED_WIDTH = 68;

// Shared shell for both dashboard areas (staff/HR and candidate) - each
// caller supplies its own nav items and user/logout details, this owns
// only the collapse mechanics and visual chrome so the two areas stay
// pixel-consistent without duplicating the sidebar itself.
export default function Sidebar({ items, userLabel, userSublabel, onLogout }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private browsing etc. */ }
      return next;
    });
  };

  const width = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <aside style={{
      width, flexShrink: 0, background: 'var(--color-surface)',
      borderRight: '1px solid var(--color-border-subtle)',
      display: 'flex', flexDirection: 'column', height: '100vh',
      position: 'sticky', top: 0, transition: 'width var(--transition)', overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px', minHeight: 60, flexShrink: 0 }}>
        <button
          onClick={toggle}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
            background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0
          }}
        >
          <Menu size={17} />
        </button>
        {!collapsed && (
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', minWidth: 0 }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 7, background: 'var(--color-primary)', color: '#fff', flexShrink: 0
            }}>
              <Plane size={14} />
            </span>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              UCAA e-Recruitment
            </span>
          </Link>
        )}
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 11,
              padding: collapsed ? '10px' : '9px 11px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderRadius: 'var(--radius-sm)', textDecoration: 'none', fontSize: 13.5, fontWeight: 500,
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: isActive ? 'var(--color-primary-tint)' : 'transparent',
              transition: 'background var(--transition), color var(--transition)'
            })}
          >
            <item.icon size={17} style={{ flexShrink: 0 }} />
            {!collapsed && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.label}</span>
            )}
            {!collapsed && item.badge ? (
              <span style={{
                fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', background: 'var(--color-primary-tint)',
                borderRadius: 999, padding: '1px 7px', flexShrink: 0
              }}>
                {item.badge}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: 10, borderTop: '1px solid var(--color-border-subtle)', flexShrink: 0 }}>
        {!collapsed && userLabel && (
          <div style={{ padding: '6px 8px 10px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {userLabel}
            </div>
            {userSublabel && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {userSublabel}
              </div>
            )}
          </div>
        )}
        <button
          onClick={onLogout}
          title={collapsed ? 'Log out' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 9, width: '100%',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '9px' : '9px 11px',
            background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer'
          }}
        >
          <LogOut size={15} />
          {!collapsed && 'Log out'}
        </button>
      </div>
    </aside>
  );
}
