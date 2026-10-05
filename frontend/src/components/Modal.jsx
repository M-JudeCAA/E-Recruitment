import React, { useId } from 'react';

export default function Modal({ title, onClose, children, footer, maxWidth = 420 }) {
  const titleId = useId();

  return (
    <div
      onClick={onClose}
      className="modal-overlay"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          background: 'var(--color-bg)', borderRadius: 'var(--radius)',
          padding: 'var(--spacing-lg)', width: '90%', maxWidth,
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <h3 id={titleId} style={{ margin: 0, color: 'var(--color-primary-dark)' }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--color-text-muted)', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        <div>{children}</div>
        {footer && <div style={{ marginTop: 'var(--spacing-md)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}
