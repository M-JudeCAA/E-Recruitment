import { Check } from 'lucide-react';

// STEPS is passed in dynamically (Internal Profile only appears for
// Internal candidates) rather than a fixed, imported constant.
export default function StepperRail({ steps, stepIndex, isComplete, visited, goTo }) {
  return (
    <>
      {/* Desktop - vertical rail */}
      <div className="hidden md:block px-6 py-8"
        style={{ width: 230, borderRight: '1px solid var(--color-border)', flexShrink: 0, background: 'var(--color-primary-dark)' }}>
        {steps.map((s, i) => {
          const active = i === stepIndex;
          const done = isComplete(i);
          return (
            <button key={s.key} onClick={() => visited[i] && goTo(i)}
              className="flex items-start gap-3 text-left w-full"
              style={{ marginBottom: i === steps.length - 1 ? 0 : 28, position: 'relative', cursor: visited[i] ? 'pointer' : 'default', background: 'none', border: 'none' }}>
              {i < steps.length - 1 && (
                <span style={{ position: 'absolute', left: 13, top: 28, width: 1, height: 28, background: done ? '#FFFFFF' : 'rgba(255,255,255,0.25)' }} />
              )}
              <span className="flex items-center justify-center flex-shrink-0" style={{
                width: 28, height: 28, borderRadius: '50%',
                border: `1.5px solid ${done || active ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}`,
                background: done ? '#FFFFFF' : active ? 'rgba(255,255,255,0.15)' : 'transparent',
                color: done ? 'var(--color-primary-dark)' : active ? '#FFFFFF' : 'rgba(255,255,255,0.7)',
                fontSize: 13
              }}>
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span>
                <span className="block" style={{ fontSize: 14, fontWeight: active ? 600 : 500, color: active || done ? '#FFFFFF' : 'rgba(255,255,255,0.65)' }}>{s.label}</span>
                <span className="block" style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{s.note}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Mobile - horizontal progress bar */}
      <div className="md:hidden px-6 pt-5 pb-2">
        <div className="flex items-center">
          {steps.map((s, i) => {
            const active = i === stepIndex;
            const done = isComplete(i);
            return (
              <div key={s.key} className="flex items-center" style={{ flex: i === steps.length - 1 ? '0' : '1' }}>
                <span className="flex items-center justify-center flex-shrink-0" style={{
                  width: 24, height: 24, borderRadius: '50%',
                  border: `1.5px solid ${done || active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: done ? 'var(--color-primary)' : active ? 'var(--color-primary-light)' : 'transparent',
                  color: done ? '#fff' : active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontSize: 11
                }}>
                  {done ? <Check size={12} /> : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span style={{ flex: 1, height: 1, background: done ? 'var(--color-primary)' : 'var(--color-border)', marginLeft: 4, marginRight: 4 }} />
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginTop: 10 }}>{steps[stepIndex].label}</div>
      </div>
    </>
  );
}
