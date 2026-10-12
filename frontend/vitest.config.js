import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The frontend test suite (`npm test`): Vitest with a jsdom browser and
// React Testing Library. Kept apart from vite.config.js, which only knows
// about serving and previewing the build. Tests live in tests/, mirroring
// src/ - see tests/README.md.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // A real page address: the site-port checks (staffPort.js) and the API
    // client read window.location.
    environmentOptions: { jsdom: { url: 'http://localhost:5173/' } },
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
    unstubGlobals: true
  }
});
