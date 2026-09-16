import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal';
import Button from './Button';

// Replaces window.confirm, which CLAUDE.md forbids (unthemed, blocks the
// event loop, can't be styled/tested). Mount <ConfirmProvider> once near the
// app root (see main.jsx) and call useConfirm() from any component; the
// returned function resolves to true/false the same way window.confirm did,
// so `if (!window.confirm(msg)) return;` becomes `if (!(await confirm(msg))) return;`.
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setRequest({
        message,
        title: options.title || 'Please confirm',
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        danger: options.danger || false,
      });
    });
  }, []);

  const settle = (result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal
          title={request.title}
          onClose={() => settle(false)}
          maxWidth={400}
          footer={
            <>
              <Button variant="ghost" onClick={() => settle(false)}>{request.cancelLabel}</Button>
              <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
                {request.confirmLabel}
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, color: 'var(--color-text)' }}>{request.message}</p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider');
  return confirm;
}
