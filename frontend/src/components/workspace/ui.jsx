import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, MoreHorizontal } from 'lucide-react';

// The staff workspace's page parts (styles in workspace.css). Every staff
// page is one of a few layouts built from these: a list page (PageTop,
// Toolbar/Chips, a Table in a Panel), a record page (PageTop with a crumb,
// NextStep, StepBar, Tabs), the Inbox (Figures, TaskGroup) and SidePanel
// for working on one item without leaving the page.

const TONE_COLORS = {
  ok: 'var(--color-accent)',
  warn: 'var(--color-warning)',
  bad: 'var(--color-danger)',
  info: 'var(--color-primary)',
  brand: 'var(--color-primary-dark)',
  neutral: 'var(--color-text-muted)'
};

/** A status label in the given tone (ok/warn/bad/info/brand/neutral). */
export function Pill({ tone = 'neutral', children }) {
  return <span className="status-badge" style={{ '--badge-color': TONE_COLORS[tone] || TONE_COLORS.neutral }}>{children}</span>;
}

/** Page header: optional crumb trail, the title, a subtitle line, and the page's actions on the right. */
export function PageTop({ crumb, title, subtitle, actions }) {
  return (
    <div>
      {crumb && (
        <nav className="ws-crumb" aria-label="Breadcrumb" style={{ marginBottom: 6 }}>
          {crumb.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="ws-dot">/</span>}
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span className={c.mono ? 'ws-mono' : undefined}>{c.label}</span>}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div className="ws-ph">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="ws-sub">{subtitle}</div>}
        </div>
        {actions && <div className="ws-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** "a · b · c" with muted separators, skipping empty parts. */
export function Meta({ parts }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  return shown.map((p, i) => (
    <React.Fragment key={i}>
      {i > 0 && <span className="ws-dot">·</span>}
      {typeof p === 'string' ? <span>{p}</span> : p}
    </React.Fragment>
  ));
}

export function Panel({ title, note, actions, children, padded = true, style }) {
  return (
    <section className="ws-panel" style={style}>
      {(title || actions) && (
        <div className="ws-panel-h">
          <div style={{ minWidth: 0 }}>
            {title && <h2>{title}</h2>}
            {note && <div className="ws-note" style={{ marginTop: 2 }}>{note}</div>}
          </div>
          {actions && <div className="ws-actions">{actions}</div>}
        </div>
      )}
      {padded ? <div className="ws-panel-b">{children}</div> : children}
    </section>
  );
}

export function Figures({ figures }) {
  return (
    <div className="ws-figures">
      {figures.map((f) => (
        <div key={f.label} className="ws-fig">
          <div className="v">{f.value ?? '—'}</div>
          <div className="l">{f.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Filter chips with counts: options [{ key, label, count }]. */
export function Chips({ options, value, onChange, style }) {
  return (
    <div className="ws-chips" role="group" style={style}>
      {options.map((o) => (
        <button key={o.key} type="button" className={`ws-chip${value === o.key ? ' on' : ''}`} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}{o.count != null && <b>{o.count}</b>}
        </button>
      ))}
    </div>
  );
}

/** Plain table: columns [{ key, label, render, align, width, className }]. */
export function Table({ columns, rows, getRowKey, onRowClick, rowClassName, emptyText = 'Nothing to show.' }) {
  if (!rows || rows.length === 0) return <div className="ws-empty">{emptyText}</div>;
  return (
    <div className="ws-table-wrap">
      <table className="ws-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'r' : undefined} style={{ width: c.width }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className={[onRowClick ? 'click' : '', rowClassName?.(row) || ''].join(' ').trim() || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={[c.align === 'right' ? 'r' : '', c.className || ''].join(' ').trim() || undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValues({ rows }) {
  return (
    <dl className="ws-kv">
      {rows.filter((r) => r && r[1] !== undefined).map(([k, v]) => (
        <React.Fragment key={k}><dt>{k}</dt><dd>{v ?? <span className="ws-note">—</span>}</dd></React.Fragment>
      ))}
    </dl>
  );
}

/** Work on one item without leaving the page. Escape or the scrim closes it. */
export function SidePanel({ title, eyebrow, badges, onClose, footer, wide = false, children }) {
  useEffect(() => {
    // A dialog opened on top of the panel (a reason, a confirmation) takes Escape first.
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <>
      <div className="ws-scrim" onClick={onClose} />
      <aside className={`ws-drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="ws-drawer-h">
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div className="ws-note" style={{ marginBottom: 2 }}>{eyebrow}</div>}
            <h2>{title}</h2>
            {badges && <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>{badges}</div>}
          </div>
          <button type="button" className="ws-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="ws-drawer-b">{children}</div>
        {footer && <div className="ws-drawer-f">{footer}</div>}
      </aside>
    </>
  );
}

/** A "⋯" (or labelled) button that opens a short menu: items [{ label, onClick, danger, disabled, divider }]. */
export function MenuButton({ items, label, ariaLabel = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="ws-menu" ref={ref}>
      <button type="button" className="btn btn-ghost" aria-haspopup="menu" aria-expanded={open} aria-label={label ? undefined : ariaLabel}
        onClick={() => setOpen((o) => !o)}
        style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)', padding: '7px 12px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, font: 'inherit' }}>
        {label || <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div className="ws-menu-list" role="menu">
          {shown.map((it, i) => (it.divider ? <hr key={`d${i}`} /> : (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'danger' : undefined} disabled={it.disabled}
              title={it.hint} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.label}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

export function EmptyPanel({ children }) {
  return <div className="ws-panel ws-empty">{children}</div>;
}

/** The signed-in staff member's id, from the session token's payload (display only - the API decides). */
export function currentStaffId() {
  try {
    const payload = JSON.parse(atob(localStorage.getItem('staffToken').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.id ?? null;
  } catch {
    return null;
  }
}

export const ROLE_RANK = { HR_Officer: 1, Senior_HR_Officer: 2, Principal_HR_Officer: 3, Manager: 4, Director: 5 };
export const rankOf = (role) => ROLE_RANK[role] || 0;

/** "16 Aug 2026" */
export function formatDay(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
