import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Newer Node versions (22+) have a localStorage/sessionStorage of their own,
// which hides the test browser's - and Node's localStorage is undefined
// unless Node is started with a file to keep it in. The app must see the
// browser's, on whatever Node runs the tests (CI uses 20).
for (const name of ['localStorage', 'sessionStorage']) {
  const browserStorage = globalThis.jsdom?.window?.[name];
  if (browserStorage) Object.defineProperty(globalThis, name, { value: browserStorage, configurable: true, writable: true });
}

// Every test starts signed out, with nothing remembered and an empty page.
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
