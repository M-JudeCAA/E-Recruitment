import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: {
    // For builds made with VITE_API_URL=same-origin (deploy/tunnel/): the
    // browser calls /api and /ws on the preview server, which forwards them
    // to the API. xfwd passes the client address on for the sign-in rate limits.
    proxy: {
      '/api': { target: apiTarget, xfwd: true },
      '/ws': { target: apiTarget, ws: true, xfwd: true }
    },
    // Tailscale Funnel hostnames.
    allowedHosts: ['.ts.net']
  }
});
