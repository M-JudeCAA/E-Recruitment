import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

const CONFIG = {
  success: { bg: 'var(--color-accent-tint)', color: 'var(--color-accent)', Icon: CheckCircle2 },
  error: { bg: 'var(--color-danger-tint)', color: 'var(--color-danger)', Icon: AlertCircle },
  info: { bg: 'var(--color-primary-tint)', color: 'var(--color-primary)', Icon: Info }
};

export default function Alert({ type = 'info', message }) {
  if (!message) return null;
  const { bg, color, Icon } = CONFIG[type];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      background: bg, color, padding: '10px 14px',
      borderRadius: 'var(--radius)', marginBottom: 'var(--spacing-md)', fontSize: 13.5
    }}>
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}
