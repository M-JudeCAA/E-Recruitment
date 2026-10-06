import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// `vite preview` settings for the office-network test deployment
// (deploy/lan/), read from frontend/.env without the VITE_ prefix so they
// never reach the browser bundle. All optional; unset, preview behaves as
// before (plain http, no proxy).
//   PREVIEW_API_TARGET      forward /api and /ws here, for builds made with
//                           VITE_API_URL=same-origin (e.g. http://127.0.0.1:4100)
//   PREVIEW_TLS_PFX         serve HTTPS with this .pfx certificate ...
//   PREVIEW_TLS_PASSPHRASE  ... and its passphrase
//   PREVIEW_ALLOWED_HOSTS   comma-separated host names testers use (IP addresses are always allowed)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PREVIEW_');
  const target = env.PREVIEW_API_TARGET;
  const preview = {};
  if (target) {
    // xfwd passes the visitor's address on, for the API's sign-in rate limits
    // (the API trusts it because the proxy is on loopback, TRUST_PROXY).
    preview.proxy = {
      '/api': { target, xfwd: true },
      '/ws': { target, ws: true, xfwd: true },
    };
  }
  if (env.PREVIEW_TLS_PFX) {
    preview.https = { pfx: fs.readFileSync(env.PREVIEW_TLS_PFX), passphrase: env.PREVIEW_TLS_PASSPHRASE };
  }
  if (env.PREVIEW_ALLOWED_HOSTS) {
    preview.allowedHosts = env.PREVIEW_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean);
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
    preview,
  };
});
