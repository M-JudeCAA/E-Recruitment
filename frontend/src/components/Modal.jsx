import React from 'react';

export default function Modal({ title, onClose, children, footer }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,28,0.45)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          padding: 'var(--spacing-lg)', width: '90%', maxWidth: 440,
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(15,23,28,0.25)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'var(--color-bg-subtle)', border: 'none', borderRadius: '50%',
              width: 28, height: 28, fontSize: 18, cursor: 'pointer',
              color: 'var(--color-text-muted)', lineHeight: 1
            }}
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
