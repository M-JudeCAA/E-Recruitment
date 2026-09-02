import React from 'react';

export default function Alert({ type = 'info', message }) {
  if (!message) return null;
  const styles = {
    success: { background: '#eaf6ef', color: 'var(--color-accent)' },
    error: { background: '#fbeceb', color: 'var(--color-danger)' },
    info: { background: 'var(--color-primary-light)', color: 'var(--color-primary)' }
  };
  return (
    <div style={{
      ...styles[type], padding: 'var(--spacing-sm) var(--spacing-md)',
      borderRadius: 'var(--radius)', marginBottom: 'var(--spacing-md)', fontSize: 14
    }}>
      {message}
    </div>
  );
}
